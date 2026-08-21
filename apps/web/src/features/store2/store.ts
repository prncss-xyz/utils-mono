// oxlint-disable no-console
import {
	isFunction,
	isReset,
	type SetStateWithReset,
} from '../store/functions'
import { sortedPush } from './utils'

type Scope = [AtomSymbol<any, any>, any][]

let count = 0

// types: primitive, derived, family, effect

type Instance<T> = {
	index: number
	getter: Getter<T> | T
	type: 'primitive' | 'derived'
	dirty: boolean
	value: T
	scope: Scope
	deps: Instance<any>[]
	subs: Instance<any>[]
	subscriptions: Set<() => void>
}

// TODO: will eventually be a tree
type Lattice<T> = Instance<T>[]

type CoreSymbol = {
	index: number
}

type PrimitiveSymbol<S> = CoreSymbol & {
	type: 'primitive'
	getter: Getter<S> | S
}

type DerivedSymbol<S, E> = CoreSymbol & {
	type: 'derived'
	getter: Getter<S>
	setter: Setter<E>
}

export type AtomSymbol<S, E> = PrimitiveSymbol<S> | DerivedSymbol<S, E>

type Read = <T, E>(symbol: AtomSymbol<T, E>) => T
type Write = <T, E>(symbol: AtomSymbol<T, E>, e: E) => void
type Getter<T> = (read: Read) => T
type Setter<E> = (read: Read, write: Write, e: E) => void

// type DerivedSymbol<T, E> = Symbol<T, E> & { type: 'derived' }

// const rootValue: PrimitiveSymbol<never, never> = 0 as never

export function primitive<V>(
	getter: V | Getter<V>,
): PrimitiveSymbol<V> & AtomSymbol<V, SetStateWithReset<V>> {
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

function call(cb: () => void) {
	cb()
}

export class Store {
	private contents
	constructor(opts: { contents: WeakMap<AtomSymbol<any, any>, Lattice<any>> }) {
		this.contents = opts.contents
	}
	static init() {
		return new Store({
			contents: new WeakMap<AtomSymbol<any, any>, Lattice<any>>(),
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
			type: symbol.type,
			getter: symbol.getter,
			dirty: false,
			scope,
			deps,
			subs,
		} as Instance<R>
		const read = <T, E>(s: AtomSymbol<T, E>) => {
			const source = this.getInstance(s)
			if (symbol.type === 'primitive') scope.push([symbol, source.value])
			else {
				sortedPush(res.deps, source)
				sortedPush(source.subs, res)
				for (const d of source.scope) scope.push(d)
			}
			return source.value
		}
		const getter = symbol.getter
		res.value = isFunction(getter) ? getter(read) : getter
		res.subscriptions = new Set()
		const content = this.contents.get(symbol)
		if (content) content.push(res)
		else this.contents.set(symbol, [res])
		return res
	}
	private notify<S>(instance: Instance<S>) {
		instance.subscriptions.forEach(call)
		for (const sub of instance.subs) {
			// TODO: skip primitive
			sub.dirty = true
			this.notify(sub)
		}
	}
	send<S, E>(symbol: AtomSymbol<S, E>, e: E): void {
		if (symbol.type === 'primitive') {
			const instance = this.getInstance(symbol)
			const res = isFunction(e) ? e(instance.value) : e
			if (isReset(res)) instance.dirty = true
			else instance.value = res
			this.notify(instance)
			return
		}
		symbol.setter(this.peek.bind(this), this.send.bind(this), e)
	}
	peek<S, E>(symbol: AtomSymbol<S, E>) {
		const instance = this.getInstance(symbol)
		if (instance.dirty) {
			const { getter } = instance
			// TODO: register reads
			instance.value = isFunction(getter)
				? getter(this.peek.bind(this))
				: getter
		}
		return instance.value
	}
	subscribe<S, E>(symbol: AtomSymbol<S, E>, notify: () => void): () => void {
		const instance = this.getInstance(symbol)
		instance.subscriptions.add(notify)
		return () => instance.subscriptions.delete(notify)
	}
}
