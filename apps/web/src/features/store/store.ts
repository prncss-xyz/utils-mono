import type { AtomInstance } from './atomInstance'

export class Store {
	base
	override
	constructor(base: WeakMap<object, any>, override: [unknown, any][] = []) {
		this.base = base
		this.override = override
	}
	cached<K extends object, A, V>(key: K, arg: A, create: (arg: A) => V) {
		let res = this.base.get(key)
		if (res === undefined) {
			res = create(arg)
			this.base.set(key, res)
		}
		return res
	}
	value<K, V>(key: K) {
		for (const [k, v] of this.override) {
			if (Object.is(k, key)) return v as V
		}
		throw new Error(`Value ${key} is not displayed in current scope`)
	}
	sub(key: unknown, v: any) {
		return new Store(this.base, [[key, v], ...this.override])
	}
}

export function createStore(): Store {
	return new Store(new WeakMap(), [])
}

export type Atom<V, H, Args extends any[], Result> = (
	store: Store,
	h: H,
) => AtomInstance<V, Args, Result>
