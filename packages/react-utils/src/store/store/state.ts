import { isoAssert } from '../../functions'
import {
	type AtomFamily,
	type AtomSymbol,
	type EffectAtom,
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
 * - `validations`: dependency validations of derived instances marked
 *   `check`, or unmounted and not yet validated at the current epoch.
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
	instances: WeakMap<AtomSymbol<any, any> | EffectAtom, Instance<any>>
	families: WeakMap<AtomFamily<any, any, any>, FamilyStorage<any, any>>
	pendingEvaluations: Set<Instance<any>>
	/**
	 * Derived values of the pending view by resolved instance, shared by pending
	 * reads until a pending write, a commit, or a change of a committed value
	 * drops it. A mount phase's pending view is non-empty only after a write
	 * into it, so it never reuses values of the ordinary pending view.
	 */
	pendingValues: Map<Instance<any>, unknown> | undefined
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
	/** Invalidates completed mount walks after writes or retention changes. */
	mountRevision: number
	/** Test instrumentation counting mount traversal calls, including cache hits. */
	mountWalks: number
	tasks: Tasks | undefined
	/**
	 * The emptied tasks of the last completed flush, taken by the next
	 * `getTasks`, so that collections that usually stay empty are not
	 * reallocated by every flush.
	 */
	spareTasks: Tasks | undefined
	phase: FlushPhase
	hydrating: boolean
	/** Getter runs in progress; store calls other than `read` are rejected meanwhile. */
	evaluatingGetters: number
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
		pendingValues: undefined,
		epoch: 0,
		instrumentation: undefined,
		mountRevision: 0,
		mountWalks: 0,
		tasks: undefined,
		spareTasks: undefined,
		phase: {
			mounts: undefined,
			effects: undefined,
			familyEvictions: undefined,
			mountWrites: undefined,
			teardowns: undefined,
			droppedEdges: undefined,
		},
		hydrating: true,
		evaluatingGetters: 0,
		...wiring,
	}
}

export function assertOutsideGetter(state: StoreState) {
	isoAssert(state.evaluatingGetters === 0, 'getters must not call the store')
}

function getTasks(state: StoreState): Tasks {
	if (state.tasks) return state.tasks
	state.tasks = state.spareTasks ?? {
		mounts: new Set(),
		primitives: new Map(),
		effects: new Set(),
		pendingFamilyEvictions: new Set(),
	}
	state.spareTasks = undefined
	if (!state.hydrating) state.scheduleFlush()
	return state.tasks
}

/**
 * Keeps the tasks of a completed flush for the next `getTasks`. The flush
 * must have drained every collection and ended its phase.
 */
export function recycleTasks(state: StoreState, tasks: Tasks) {
	const { phase } = state
	isoAssert(
		phase.mounts === undefined &&
			phase.effects === undefined &&
			phase.familyEvictions === undefined &&
			phase.mountWrites === undefined &&
			phase.teardowns === undefined &&
			phase.droppedEdges === undefined,
	)
	isoAssert(
		tasks.mounts.size === 0 &&
			tasks.primitives.size === 0 &&
			tasks.effects.size === 0 &&
			tasks.pendingFamilyEvictions.size === 0,
	)
	state.spareTasks = tasks
}

export function queueMount(state: StoreState, instance: Instance<any>) {
	;(state.phase.mounts ?? getTasks(state).mounts).add(instance)
}

export function queueEffect<S>(state: StoreState, instance: Instance<S>) {
	if (instance.symbol.type !== 'effect') return
	;(state.phase.effects ?? getTasks(state).effects).add(instance)
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
	state.mountRevision++
	dropPendingValues(state)
}

/**
 * Drops the derived values shared by pending reads. Pending writes, commits and
 * committed value changes call it; the next pending read starts a new cache.
 */
export function dropPendingValues(state: StoreState) {
	state.pendingValues = undefined
}

export function advanceDerivedVersion<S>(
	state: StoreState,
	instance: Instance<S>,
) {
	instance.version++
}

export function countOperation(
	state: StoreState,
	operation: Operation,
	symbol: AtomSymbol<any, any> | EffectAtom,
) {
	const instrumentation = state.instrumentation
	if (instrumentation === undefined) return
	instrumentation.totals[operation]++
	const name = symbol.type === 'effect' ? undefined : symbol.name
	if (name === undefined) return
	let named = instrumentation.byName.get(name)
	if (named === undefined) {
		named = {}
		instrumentation.byName.set(name, named)
	}
	named[operation] = (named[operation] ?? 0) + 1
}
