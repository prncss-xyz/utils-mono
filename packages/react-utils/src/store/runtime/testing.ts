import { isoAssert } from '../../functions'
import type { Hydrate, Store } from '../atoms'
import type { createStore as publicCreateStore } from '../store'
import { createRuntime, type StoreState } from './createRuntime'

const states = new WeakMap<Store, StoreState>()

export const createStore: typeof publicCreateStore = ((hydrate?: Hydrate) => {
	const { store, state } = createRuntime(hydrate)
	states.set(store, state)
	return store
}) as typeof publicCreateStore

export function inspect(store: Store): StoreState {
	const state = states.get(store)
	isoAssert(state, 'store was not created by runtime/testing')
	return state
}
