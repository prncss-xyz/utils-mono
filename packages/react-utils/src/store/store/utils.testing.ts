import type fc from 'fast-check'

import type { createStore as publicCreateStore } from '.'
import { isoAssert } from '../../functions'
import {
	derivedAtom,
	type AtomSymbol,
	type EffectAtom,
	type Hydrate,
	type Store,
} from '../atoms'
import { createRuntime } from './createRuntime'
import { consumerCount, mountedDependencyCount } from './graph'
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

/** One operation's counts by atom name, for every name with any count. */
export function countsByName(
	instrumentation: Instrumentation,
	operation: Operation,
): Record<string, number | undefined> {
	return Object.fromEntries(
		Array.from(instrumentation.byName, ([name, counts]) => [
			name,
			counts[operation],
		]),
	)
}

/** Stops counting the store's operations. */
export function stopCountingOperations(store: Store) {
	inspect(store).instrumentation = undefined
}

export function layeredGraph(source: AtomSymbol<number, any>) {
	let layer = [source as AtomSymbol<number, never>]
	for (let level = 0; level < 10; level++) {
		const previous = layer
		layer = Array.from({ length: 2 }, (_, index) =>
			derivedAtom(
				(read) => previous.reduce((sum, atom) => sum + read(atom), 0),
				null,
				{ name: `layer ${level} node ${index}` },
			),
		)
	}
	return derivedAtom(
		(read) => layer.reduce((sum, atom) => sum + read(atom), 0),
		null,
		{ name: 'top' },
	)
}

export function chain<Args extends unknown[]>(
	source: AtomSymbol<number, Args>,
	length: number,
) {
	let tip = derivedAtom((read) => read(source) + 1)
	for (let index = 1; index < length; index++) {
		const previous = tip
		tip = derivedAtom((read) => read(previous) + 1)
	}
	return tip
}

export { consumerCount, mountedDependencyCount }

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

export { flushMicrotask } from '../../utils.testing'

export const internalInstance = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args> | EffectAtom,
) => {
	const instance = inspect(store).instances.get(symbol as AtomSymbol<any, any>)
	isoAssert(instance)
	return instance
}

export const mountedSubCount = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => consumerCount(internalInstance(store, symbol))

export const mountCount = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args> | EffectAtom,
) => internalInstance(store, symbol).mountCount
