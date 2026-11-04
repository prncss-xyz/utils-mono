import type fc from 'fast-check'

import type { createStore as publicCreateStore } from '.'
import { isoAssert } from '../../functions'
import type { Hydrate, Store } from '../atoms'
import { createRuntime } from './createRuntime'
import { createState, type Operation, type StoreState } from './state'

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

export type Instrumentation = NonNullable<StoreState['instrumentation']>

export type OperationCounts = Record<Operation, number>

export function createOperationCounts(): OperationCounts {
	return {
		getters: 0,
		pendingGetters: 0,
		invalidations: 0,
		validations: 0,
		notifications: 0,
		effects: 0,
		cleanups: 0,
	}
}

/**
 * Starts counting the store's operations from zero, replacing any previous
 * counters, and returns the live counters.
 */
export function countOperations(store: Store): Instrumentation {
	const instrumentation: Instrumentation = {
		totals: createOperationCounts(),
		byName: new Map(),
	}
	inspect(store).instrumentation = instrumentation
	return instrumentation
}

/** Stops counting the store's operations. */
export function stopCountingOperations(store: Store) {
	inspect(store).instrumentation = undefined
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

export { flushMicrotask } from '../utils.testing'
