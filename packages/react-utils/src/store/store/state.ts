import { isoAssert } from '../../functions'
import {
	type AtomFamily,
	type AtomSymbol,
	type Read,
	type Write,
} from '../atoms'
import {
	type FamilyStorage,
	type FlushPhase,
	type Instance,
	type Tasks,
} from './types'

/**
 * Work counted by opt-in instrumentation:
 * - `getters`: derived getter runs for the committed view.
 * - `pendingGetters`: derived getter runs for the pending view read by setters.
 * - `invalidations`: instances reached by change propagation in a flush.
 * - `validations`: dependency validations of unmounted derived instances.
 * - `notifications`: subscription callback calls.
 * - `effects`: effect calls.
 * - `cleanups`: calls of cleanups returned by `onMount` or effects.
 */
export type Operation =
	| 'getters'
	| 'pendingGetters'
	| 'invalidations'
	| 'validations'
	| 'notifications'
	| 'effects'
	| 'cleanups'

type OperationCounts = Record<Operation, number>

export type StoreState = {
	instances: WeakMap<AtomSymbol<any, any>, Instance<any>>
	families: WeakMap<AtomFamily<any, any, any>, FamilyStorage<any, any>>
	pendingEvaluations: Set<Instance<any>>
	epoch: number
	/**
	 * Opt-in operation counters, in total and by atom name; `undefined`
	 * disables counting. They hold only numbers and strings, so they never keep
	 * an instance or a symbol alive.
	 */
	instrumentation:
		| {
				totals: OperationCounts
				byName: Map<string, Partial<OperationCounts>>
		  }
		| undefined
	tasks: Tasks | undefined
	phase: FlushPhase
	hydrating: boolean
	read: Read
	write: Write
	readPending: Read
	scheduleFlush: () => void
}

export function createState(
	wiring: Pick<StoreState, 'read' | 'write' | 'readPending' | 'scheduleFlush'>,
): StoreState {
	isoAssert(wiring.read)
	isoAssert(wiring.write)
	isoAssert(wiring.readPending)
	isoAssert(wiring.scheduleFlush)
	return {
		instances: new WeakMap(),
		families: new WeakMap(),
		pendingEvaluations: new Set(),
		epoch: 0,
		instrumentation: undefined,
		tasks: undefined,
		phase: {
			mounts: undefined,
			reconciles: undefined,
			effects: undefined,
			familyEvictions: undefined,
			mountWrites: undefined,
		},
		hydrating: true,
		...wiring,
	}
}

function getTasks(state: StoreState): Tasks {
	if (state.tasks) return state.tasks
	state.tasks = {
		mounts: new Set(),
		primitives: new Map(),
		effects: new Set(),
		reconciles: new Set(),
		pendingFamilyEvictions: new Set(),
	}
	if (!state.hydrating) state.scheduleFlush()
	return state.tasks
}

export function queueMount(state: StoreState, instance: Instance<any>) {
	;(state.phase.mounts ?? getTasks(state).mounts).add(instance)
}

export function queueEffect<S>(state: StoreState, instance: Instance<S>) {
	if (!instance.symbol.effect) return
	;(state.phase.effects ?? getTasks(state).effects).add(instance)
}

export function queueReconcile<S>(state: StoreState, instance: Instance<S>) {
	if (instance.symbol.type !== 'derived') return
	;(state.phase.reconciles ?? getTasks(state).reconciles).add(instance)
}

export function queueEviction(state: StoreState, instance: Instance<any>) {
	getTasks(state).pendingFamilyEvictions.add(instance)
}

export function pendingWrites(
	state: StoreState,
	write: true,
): Map<Instance<any>, any>

export function pendingWrites(
	state: StoreState,
	write?: false,
): Map<Instance<any>, any> | undefined

export function pendingWrites(state: StoreState, write = false) {
	return (
		state.phase.mountWrites ??
		(write ? getTasks(state).primitives : state.tasks?.primitives)
	)
}

export function cancelEviction<S>(state: StoreState, instance: Instance<S>) {
	state.tasks?.pendingFamilyEvictions.delete(instance)
	state.phase.familyEvictions?.delete(instance)
	if (instance.familyRemovalTimeout !== undefined) {
		clearTimeout(instance.familyRemovalTimeout)
		instance.familyRemovalTimeout = undefined
	}
}

/**
 * Publishes a change of this instance's value: bumps its version and
 * advances `epoch` so unmounted dependants re-check their dependencies.
 * Commits and evictions use it; derived recomputes use
 * `advanceDerivedVersion`, which never advances `epoch`.
 */
export function publishChange<S>(state: StoreState, instance: Instance<S>) {
	instance.version++
	state.epoch++
}

export function advanceDerivedVersion<S>(
	state: StoreState,
	instance: Instance<S>,
) {
	instance.version++
}

/** Callers check `state.instrumentation` first, keeping disabled counting to a field read. */
export function countOperation(
	state: StoreState,
	operation: Operation,
	symbol: AtomSymbol<any, any>,
) {
	const instrumentation = state.instrumentation
	isoAssert(instrumentation)
	instrumentation.totals[operation]++
	const { name } = symbol
	if (name === undefined) return
	let named = instrumentation.byName.get(name)
	if (named === undefined) {
		named = {}
		instrumentation.byName.set(name, named)
	}
	named[operation] = (named[operation] ?? 0) + 1
}
