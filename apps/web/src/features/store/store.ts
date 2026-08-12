import type { AtomInstance } from './atomInstance'

export type Store = WeakMap<object, any>

export function createStore(): Store {
	return new WeakMap<object, any>()
}

export type Atom<V, H, Args extends any[], Result> = (
	store: Store,
	h: H,
) => AtomInstance<V, Args, Result>
