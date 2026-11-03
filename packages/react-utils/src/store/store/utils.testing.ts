import type fc from 'fast-check'

import type { createStore as publicCreateStore } from '.'
import { isoAssert } from '../../functions'
import type { Hydrate, Store } from '../atoms'
import { createRuntime } from './createRuntime'
import { createState, type StoreState } from './state'

const states = new WeakMap<Store, StoreState>()

export const createStore: typeof publicCreateStore = ((hydrate?: Hydrate) => {
	const { store, state } = createRuntime(hydrate)
	states.set(store, state)
	return store
}) as typeof publicCreateStore

export function inspect(store: Store): StoreState {
	const state = states.get(store)
	isoAssert(state, 'store was not created by store/utils.testing')
	return state
}

export {
	consumerCount,
	deferredOwnerCount,
	mountedDependencyCount,
} from './graph'

/** A state whose wiring is inert, for unit tests of registry and graph primitives. */
export function createStubState(): StoreState {
	return createState({
		read: (() => {}) as never,
		write: (() => {}) as never,
		readPending: (() => {}) as never,
		scheduleFlush: () => {},
	})
}

export type Value<A> = A extends fc.Arbitrary<infer V> ? V : never

export const flushMicrotask = () => Promise.resolve()
