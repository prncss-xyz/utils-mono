import { exhaustive, isoAssert } from '../../functions'
import { type Effect } from '../atoms'
import { getCleanupOrder } from './cleanupOrder'
import { peekInstance, cleanupEffect, runCleanup } from './engine'
import { consumers, mountedDependencies, dependencies } from './graph'
import { evict } from './registry'
import {
	type StoreState,
	queueReconcile,
	queueEffect,
	publishChange,
	countOperation,
} from './state'
import {
	type Delivery,
	type EffectLifecycle,
	type Instance,
	type MountLifecycle,
	type Transition,
} from './types'

function invalidate<S>(
	state: StoreState,
	instance: Instance<S>,
	affected: Set<Instance<any>>,
) {
	if (affected.has(instance)) return
	affected.add(instance)
	if (state.instrumentation)
		countOperation(state, 'invalidations', instance.symbol)
	if (instance.symbol.type === 'derived') instance.freshness = { type: 'dirty' }
	if (instance.mountCount > 0) {
		queueReconcile(state, instance)
		queueEffect(state, instance)
	}
	for (const sub of consumers(instance)) invalidate(state, sub, affected)
}

/**
 * Delivers to a snapshot of subscription registrations. A registration
 * removed or replaced before its turn is skipped; one created during
 * delivery (including a re-subscription by the same callback) waits for a
 * later notification.
 */
function notify(state: StoreState, roots: Iterable<Instance<any>>) {
	const affected = new Set<Instance<any>>()
	for (const root of roots) invalidate(state, root, affected)
	const deliveries: Delivery[] = []
	for (const instance of affected)
		for (const [callback, registration] of instance.subscriptions)
			deliveries.push({ instance, callback, registration })
	for (const { instance, callback, registration } of deliveries)
		if (instance.subscriptions.get(callback) === registration) {
			if (state.instrumentation)
				countOperation(state, 'notifications', instance.symbol)
			callback()
		}
}

function mount<S>(state: StoreState, instance: Instance<S>) {
	if (instance.mountCount === 0 || instance.mountLifecycle) return
	const lifecycle: MountLifecycle = {}
	instance.mountLifecycle = lifecycle
	const cleanup = instance.symbol.onMount?.(state.read, state.write)
	if (cleanup) {
		if (instance.mountLifecycle === lifecycle) lifecycle.cleanup = cleanup
		else runCleanup(state, instance, cleanup)
	}
}

function runEffect<S>(
	state: StoreState,
	instance: Instance<S>,
	effect: Effect<S>,
	next: S,
	last: S | undefined,
) {
	const lifecycle: EffectLifecycle<S> = {
		value: next,
		instance,
		cleaning: false,
		deferredReleases: new Set(),
		dependencies: new Set(),
	}
	const visited = new Set<Instance<any>>()
	const collect = (dependency: Instance<any>) => {
		if (visited.has(dependency)) return
		visited.add(dependency)
		if (dependency.effectLifecycle) {
			lifecycle.dependencies.add(dependency)
			return
		}
		for (const dep of mountedDependencies(dependency)) collect(dep)
	}
	for (const dep of mountedDependencies(instance)) collect(dep)
	instance.effectLifecycle = lifecycle
	if (state.instrumentation) countOperation(state, 'effects', instance.symbol)
	const cleanup = effect(next, last, state.read, state.write)
	if (cleanup) {
		if (instance.effectLifecycle === lifecycle) lifecycle.cleanup = cleanup
		else runCleanup(state, instance, cleanup)
	}
}

export function flush(state: StoreState) {
	isoAssert(state.tasks, 'unexpected call to flush')
	const { mounts, primitives, effects, reconciles, pendingFamilyEvictions } =
		state.tasks
	const mountWrites = new Map<Instance<any>, any>()
	state.tasks = undefined
	state.phase.mounts = mounts
	state.phase.effects = effects
	state.phase.reconciles = reconciles
	state.phase.familyEvictions = pendingFamilyEvictions
	settle(state, primitives, mounts, reconciles, mountWrites)
	if (effects.size > 0) {
		const transitions = collectTransitions(state, effects)
		runCleanups(state, transitions)
		runTransitions(state, transitions)
	} else state.phase.effects = undefined
	scheduleEvictions(state, pendingFamilyEvictions)
}

function applyUpdates(state: StoreState, pending: Map<Instance<any>, any>) {
	while (pending.size > 0) {
		const updates = [...pending]
		pending.clear()
		const changed: Instance<any>[] = []
		for (const [instance, next] of updates)
			if (!Object.is(next, instance.value)) {
				instance.value = next
				publishChange(state, instance)
				changed.push(instance)
			}
		notify(state, changed)
	}
}

function settleMount(
	state: StoreState,
	instance: Instance<any>,
	mounts: Set<Instance<any>>,
	mountWrites: Map<Instance<any>, any>,
) {
	if (instance.mountCount === 0 || instance.mountLifecycle) {
		mounts.delete(instance)
		return
	}
	peekInstance(state, instance)
	for (const dep of dependencies(instance))
		settleMount(state, dep, mounts, mountWrites)
	mounts.delete(instance)
	state.phase.mountWrites = mountWrites
	mount(state, instance)
	state.phase.mountWrites = undefined
	// Mount writes must settle before consumers mount or effects run.
	applyUpdates(state, mountWrites)
}

function reconcile(
	state: StoreState,
	instance: Instance<any>,
	reconciles: Set<Instance<any>>,
) {
	if (!reconciles.delete(instance)) return
	for (const sub of Array.from(consumers(instance)))
		reconcile(state, sub, reconciles)
	if (instance.mountCount > 0) peekInstance(state, instance)
}

function settle(
	state: StoreState,
	primitives: Map<Instance<any>, any>,
	mounts: Set<Instance<any>>,
	reconciles: Set<Instance<any>>,
	mountWrites: Map<Instance<any>, any>,
) {
	applyUpdates(state, primitives)
	do {
		applyUpdates(state, mountWrites)
		for (const instance of reconciles) reconcile(state, instance, reconciles)
		for (const instance of mounts)
			settleMount(state, instance, mounts, mountWrites)
	} while (mountWrites.size > 0 || mounts.size > 0 || reconciles.size > 0)
	state.phase.mounts = undefined
	state.phase.reconciles = undefined
}

function collectTransitions(
	state: StoreState,
	effects: Set<Instance<any>>,
): Transition[] {
	const visited = new Set<Instance<any>>()
	const transitions: Transition[] = []
	const collect = (instance: Instance<any>) => {
		if (visited.has(instance) || instance.mountCount === 0) return
		visited.add(instance)
		const next = peekInstance(state, instance)
		for (const dep of dependencies(instance)) collect(dep)
		if (
			effects.has(instance) &&
			(!instance.effectLifecycle ||
				!Object.is(next, instance.effectLifecycle.value))
		) {
			const effect = instance.symbol.effect
			isoAssert(effect)
			transitions.push({
				instance,
				effect,
				next,
				previous: instance.effectLifecycle,
				mountLifecycle: instance.mountLifecycle,
			})
		}
	}
	for (const instance of effects) collect(instance)
	state.phase.effects = undefined
	return transitions
}

function runCleanups(state: StoreState, transitions: Transition[]) {
	const cleanupOrder = getCleanupOrder(
		transitions.map(({ instance }) => instance),
	)
	// Release consumers before the resources provided by their dependencies.
	for (let index = cleanupOrder.length - 1; index >= 0; index--) {
		const instance = cleanupOrder[index]!
		if (instance.mountCount === 0) continue
		const lifecycle = instance.effectLifecycle
		if (lifecycle) cleanupEffect(state, lifecycle)
	}
}

function runTransitions(state: StoreState, transitions: Transition[]) {
	// Recreate dependency resources before their consumers run.
	for (const {
		instance,
		effect,
		next,
		previous,
		mountLifecycle,
	} of transitions)
		if (
			instance.mountCount > 0 &&
			instance.mountLifecycle === mountLifecycle &&
			instance.effectLifecycle === previous
		)
			runEffect(state, instance, effect, next, previous?.value)
}

function scheduleEvictions(
	state: StoreState,
	pendingFamilyEvictions: Set<Instance<any>>,
) {
	for (const instance of pendingFamilyEvictions) {
		if (instance.mountCount > 0) continue
		const { familyEntry } = instance
		isoAssert(familyEntry)
		const { retention } = familyEntry
		switch (retention.type) {
			case 'immediate':
				evict(state, instance)
				break
			case 'timed':
				isoAssert(instance.familyRemovalTimeout === undefined)
				instance.familyRemovalTimeout = setTimeout(() => {
					instance.familyRemovalTimeout = undefined
					isoAssert(instance.mountCount === 0)
					evict(state, instance)
				}, retention.ms)
				break
			default:
				exhaustive(retention)
		}
	}
	state.phase.familyEvictions = undefined
}
