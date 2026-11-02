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

export type StoreState = {
	instances: WeakMap<AtomSymbol<any, any>, Instance<any>>
	families: WeakMap<AtomFamily<any, any, any>, FamilyStorage<any, any>>
	pendingEvaluations: Set<Instance<any>>
	epoch: number
	/** Test instrumentation counting every dependency validation call. */
	validations: number
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
		validations: 0,
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
