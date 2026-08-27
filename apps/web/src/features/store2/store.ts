// oxlint-disable no-console
import { noop } from '@prncss-xyz/react-utils'

import { isFunction, isReset, type SetStateWithReset } from '../store/functions'
import { addScope, sortedPush, sortedRemove } from './utils'

type Scope = [AtomSymbol<any, any>, any][]

let count = 0

function exhaustive(n: never): never {
	throw new Error(`unexpected value ${n}`)
}

type Instance<T> = {
	index: number
	symbol: AtomSymbol<T, any>
	getter: Getter<T> | T
	doer: Doer<any> | undefined
	type: 'primitive' | 'derived'
	value: T
	scope: Scope
	deps: Instance<any>[]
	subs: Instance<any>[]
}

// TODO: will eventually be a tree
type Lattice<T> = Instance<T>[]

type CoreSymbol = {
	index: number
}

type PrimitiveSendAction =
	| { type: 'value'; value: any }
	| { type: 'callbacks'; value: ((value: any) => any)[] }

type PrimitiveSymbol<S, E> = CoreSymbol & {
	type: 'primitive'
	getter: Getter<S> | S
	readonly event?: E
}

type DerivedSymbol<S, E> = CoreSymbol & {
	type: 'derived'
	getter: Getter<S>
	setter: Setter<E>
}

type EffectSymbol<S> = CoreSymbol & {
	type: 'effect'
	getter: Getter<S>
	tracker: Getter<any>
	doer: Doer<any>
}

export type AtomSymbol<S, E> =
	| PrimitiveSymbol<S, E>
	| DerivedSymbol<S, E>
	| EffectSymbol<S>

type Read = <T, E>(symbol: AtomSymbol<T, E>) => T
type Write = <T, E>(symbol: AtomSymbol<T, E>, e: E) => void
type Getter<T> = (read: Read) => T
type Setter<E> = (read: Read, write: Write, e: E) => void
type Doer<S> = (s: S) => void

// TODO: override
// TODO: effect
// TODO: family
// TODO: external

export function primitive<V>(
	getter: V | Getter<V>,
): PrimitiveSymbol<V, SetStateWithReset<V>> {
	return {
		type: 'primitive' as const,
		getter,
		index: count++,
	}
}

export function derived<V, E>(
	getter: Getter<V>,
	setter: Setter<E>,
): DerivedSymbol<V, E> {
	return {
		type: 'derived' as const,
		getter,
		setter,
		index: count++,
	}
}

export function effect<S>(
	tracker: Getter<S>,
	doer: Doer<S>,
): AtomSymbol<void, never> {
	return {
		type: 'effect' as const,
		getter: noop,
		tracker,
		doer,
		index: count++,
	}
}

function call(cb: () => void) {
	cb()
}

export class Store {
	private contents
	private subscriptions
	private nextPrimitiveValues:
		| Map<PrimitiveSymbol<any, any>, PrimitiveSendAction>
		| undefined = undefined
	constructor(opts: {
		contents: WeakMap<AtomSymbol<any, any>, Lattice<any>>
		subscriptions: WeakMap<AtomSymbol<any, any>, Set<() => void>>
	}) {
		this.contents = opts.contents
		this.subscriptions = opts.subscriptions
	}
	static init() {
		return new Store({
			contents: new WeakMap<AtomSymbol<any, any>, Lattice<any>>(),
			subscriptions: new WeakMap<AtomSymbol<any, any>, Set<() => void>>(),
		})
	}
	private findInstance<R, S>(symbol: AtomSymbol<R, S>) {
		const content = this.contents.get(symbol)
		if (!content) return
		outer: for (const row of content) {
			for (const [k, v] of row.scope) {
				if (!this.findInstance(k)) continue outer
				if (!Object.is(this.findInstance(k)?.value, v)) continue outer
			}
			return row as Instance<R>
		}
	}
	getInstance<R, S>(symbol: AtomSymbol<R, S>): Instance<R> {
		const instance = this.findInstance(symbol)
		if (instance) return instance
		const scope: Scope = []
		const deps: Instance<any>[] = []
		const subs: Instance<any>[] = []
		const res = {
			index: symbol.index,
			symbol,
			type: symbol.type,
			getter: symbol.getter,
			doer: symbol.type === 'effect' ? symbol.doer : undefined,
			scope,
			deps,
			subs,
		} as Instance<R>
		const read = <T, E>(s: AtomSymbol<T, E>) => {
			const source = this.getInstance(s)
			if (symbol.type === 'primitive') addScope(scope, s, source.value)
			else {
				sortedPush(res.deps, source)
				sortedPush(source.subs, res)
				for (const [atom, value] of source.scope) {
					addScope(scope, atom, value)
				}
			}
			return source.value
		}
		const getter = symbol.getter
		res.value = isFunction(getter) ? getter(read) : getter
		const content = this.contents.get(symbol)
		if (content) content.push(res)
		else this.contents.set(symbol, [res])
		return res
	}
	private removeInstance(instance: Instance<any>) {
		const content = this.contents.get(instance.symbol)
		const index = content?.indexOf(instance) ?? -1
		if (index !== -1) content?.splice(index, 1)
		for (const dep of instance.deps) sortedRemove(dep.subs, instance)
	}
	private notify<S>(instance: Instance<S>) {
		this.subscriptions.get(instance.symbol)?.forEach(call)
		for (const sub of [...instance.subs]) {
			this.removeInstance(sub)
			this.notify(sub)
		}
	}
	send<S, E>(symbol: AtomSymbol<S, E>, value: E): void {
		switch (symbol.type) {
			case 'primitive': {
				if (!this.nextPrimitiveValues) {
					queueMicrotask(this.flush.bind(this))
					this.nextPrimitiveValues = new Map()
				}
				if (isFunction(value)) {
					const res = this.nextPrimitiveValues.get(symbol)
					if (res?.type === 'callbacks') {
						res.value.push(value)
						return
					}
					this.nextPrimitiveValues.set(symbol, {
						type: 'callbacks',
						value: [value],
					})
					return
				}
				this.nextPrimitiveValues.set(symbol, { type: 'value', value })
				return
			}
			case 'derived': {
				symbol.setter(this.peek.bind(this), this.send.bind(this), value)
				return
			}
			case 'effect': {
				return
			}
			default:
				return exhaustive(symbol)
		}
	}
	flush() {
		for (const [symbol, sendValue] of this.nextPrimitiveValues!) {
			if (isReset(sendValue.value)) {
				const instance = this.findInstance(symbol)
				if (instance) {
					this.removeInstance(instance)
					this.notify(instance)
				}
				continue
			}
			const instance = this.getInstance(symbol)
			let next: any
			if (sendValue.type === 'callbacks') {
				next = instance.value
				for (const cb of sendValue.value) next = cb(next)
			} else next = sendValue.value
			if (!Object.is(next, instance.value)) {
				instance.value = next
				this.notify(instance)
			}
		}
		this.nextPrimitiveValues = undefined
	}
	peek<S, E>(symbol: AtomSymbol<S, E>) {
		return this.getInstance(symbol).value
	}
	subscribe<S, E>(symbol: AtomSymbol<S, E>, notify: () => void): () => void {
		const subscriptions = this.subscriptions.get(symbol) ?? new Set()
		subscriptions.add(notify)
		this.subscriptions.set(symbol, subscriptions)
		return () => subscriptions.delete(notify)
	}
}
