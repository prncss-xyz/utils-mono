import { noop } from '@prncss-xyz/react-utils'
// TODO: dirty

import {
	fromInit,
	isFunction,
	isReset,
	type SetStateWithReset,
} from '../store/functions'
import { sortedPush, sortedRemove } from './utils'

let count = 0

function call(cb: () => void) {
	cb()
}

function exhaustive(n: never): never {
	throw new Error(`unexpected value ${n}`)
}

type Instance<T> = {
	index: number
	type: AtomSymbol<any, any>['type']
	dirty: boolean // TODO:
	value: T
	deps: Instance<any>[]
	subs: Instance<any>[]
	subscriptions: Set<() => void>
}

type CoreSymbol = {
	index: number
}

export type PrimitiveSymbol<S, E> = CoreSymbol & {
	type: 'primitive'
	getter: (() => S) | S
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
type Doer<S> = (next: S | undefined, last: S | undefined) => void

// TODO: effect
// TODO: family
// TODO: external

export function primitive<V>(
	getter: V | (() => V),
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

export class Store {
	private contents = new WeakMap<AtomSymbol<any, any>, Instance<any>>()
	private nextPrimitiveValues: Map<PrimitiveSymbol<any, any>, any> | undefined =
		undefined
	constructor() {}
	private getInstance<R, S>(symbol: AtomSymbol<R, S>): Instance<R> {
		let instance = this.contents.get(symbol)
		if (instance) return instance
		instance = {
			index: symbol.index,
			type: symbol.type,
			dirty: true,
			value: undefined as any,
			deps: [],
			subs: [],
			subscriptions: new Set(),
		}
		this.contents.set(symbol, instance)
		return instance
	}
	private notify<S>(instance: Instance<S>) {
		if (instance.type === 'derived') instance.dirty = true
		for (const sub of instance.subs) {
			this.notify(sub)
		}
		instance.subscriptions.forEach(call)
	}
	send<S, E>(symbol: AtomSymbol<S, E>, next: E): void {
		switch (symbol.type) {
			case 'primitive': {
				if (!this.nextPrimitiveValues) {
					queueMicrotask(this.flush.bind(this))
					this.nextPrimitiveValues = new Map()
				}
				let res: any
				if (isFunction(next)) {
					const last = this.nextPrimitiveValues.has(symbol)
						? this.nextPrimitiveValues.get(symbol)
						: this.peek(symbol)
					res = next(last)
				} else {
					res = next
				}
				this.nextPrimitiveValues.set(symbol, res)
				return
			}
			case 'derived': {
				symbol.setter(this.peek.bind(this), this.send.bind(this), next)
				return
			}
			case 'effect': {
				throw new Error('You cannot write to an effect')
			}
			default:
				return exhaustive(symbol)
		}
	}
	flush() {
		const nextPrimitiveValues = this.nextPrimitiveValues!
		this.nextPrimitiveValues = undefined
		// oxlint-disable-next-line prefer-const
		for (let [symbol, next] of nextPrimitiveValues) {
			const instance = this.getInstance(symbol)
			if (isReset(next)) next = instance.dirty = true
			if (!Object.is(next, instance.value)) {
				instance.value = next
				this.notify(instance)
			}
		}
	}
	peek<S, E>(symbol: AtomSymbol<S, E>) {
		const instance = this.getInstance(symbol)
		if (instance.dirty) {
			instance.dirty = false
			switch (symbol.type) {
				case 'primitive':
					instance.value = fromInit(symbol.getter)
					break
				case 'derived':
					for (const dep of instance.deps) {
						sortedRemove(instance.deps, dep)
						sortedRemove(dep.subs, instance)
					}
					instance.value = symbol.getter(<T, E>(s: AtomSymbol<T, E>) => {
						const dep = this.getInstance(s)
						sortedPush(instance.deps, dep)
						sortedPush(dep.subs, instance)
						return this.peek(s)
					})
					break
				case 'effect':
					break
				default:
					exhaustive(symbol)
			}
		}
		return instance.value
	}
	subscribe<S, E>(symbol: AtomSymbol<S, E>, notify: () => void): () => void {
		const instance = this.getInstance(symbol)
		instance.subscriptions.add(notify)
		return () => instance.subscriptions.delete(notify)
	}
}
