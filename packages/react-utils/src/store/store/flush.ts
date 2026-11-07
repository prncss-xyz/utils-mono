import { exhaustive, isoAssert } from '../../functions'
import { type Read, type MountEffect } from '../atoms'
import {
	peekInstance,
	retain,
	release,
	link,
	syncMountedDeps,
	releaseChildren,
	runCleanup,
	assertOwnershipEdge,
} from './engine'
import {
	consumers,
	dependencies,
	hasMountedDependency,
	resetDependencies,
	recordDependency,
	dependencyVersions,
} from './graph'
import { evict, getInstance, getEffectInstance } from './registry'
import {
	type StoreState,
	queueReconcile,
	queueEffect,
	publishChange,
	countOperation,
} from './state'
import { type Delivery, type Instance, type MountLifecycle } from './types'

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

function mounting(
	state: StoreState,
	owner: Instance<any>,
	lifecycle: MountLifecycle,
) {
	let calling = true
	const mountEffect: MountEffect = (effect) => {
		isoAssert(
			calling && lifecycle.active,
			'mountEffect must be called synchronously during its owner body',
		)
		const child = getEffectInstance(state, effect)
		assertOwnershipEdge(owner, child)
		lifecycle.children.push(child)
		child.owners.set(owner, (child.owners.get(owner) ?? 0) + 1)
		retain(state, child)
	}
	return {
		mountEffect,
		done: () => {
			calling = false
		},
	}
}

function mount<S>(state: StoreState, instance: Instance<S>) {
	if (instance.mountCount === 0 || instance.mountLifecycle) return
	const lifecycle: MountLifecycle = { children: [], active: true }
	instance.mountLifecycle = lifecycle
	isoAssert(instance.symbol.type !== 'effect')
	const scope = mounting(state, instance, lifecycle)
	const cleanup = instance.symbol.onMount?.(
		state.read,
		state.write,
		scope.mountEffect,
	)
	scope.done()
	if (cleanup) {
		if (instance.mountLifecycle === lifecycle) lifecycle.cleanup = cleanup
		else runCleanup(state, instance, cleanup)
	}
}

function runEffect(
	state: StoreState,
	instance: Instance<any>,
	mounts: Set<Instance<any>>,
	reconciles: Set<Instance<any>>,
	mountWrites: Map<Instance<any>, any>,
) {
	isoAssert(instance.symbol.type === 'effect')
	const previous = instance.effectLifecycle
	if (previous) {
		const cleanup = previous.cleanup
		previous.cleanup = undefined
		runCleanup(state, instance, cleanup)
		releaseChildren(state, instance, previous)
		if (instance.effectLifecycle !== previous || instance.mountCount === 0)
			return
		previous.active = false
	}
	const lifecycle: MountLifecycle = { children: [], active: true }
	instance.effectLifecycle = lifecycle
	if (state.instrumentation) countOperation(state, 'effects', instance.symbol)
	resetDependencies(instance)
	const read: Read = ((symbol, key) => {
		const dep = getInstance(state, symbol, key)
		assertOwnershipEdge(instance, dep)
		peekInstance(state, dep)
		if (lifecycle.active) {
			if (!hasMountedDependency(instance, dep)) link(state, instance, dep)
			settle(state, new Map(), mounts, reconciles, mountWrites)
		}
		const value = peekInstance(state, dep)
		if (lifecycle.active) recordDependency(instance, dep, dep.version)
		return value
	}) as Read
	const scope = mounting(state, instance, lifecycle)
	const cleanup = instance.symbol.body(read, state.write, scope.mountEffect)
	scope.done()
	if (cleanup) {
		if (instance.effectLifecycle === lifecycle) lifecycle.cleanup = cleanup
		else runCleanup(state, instance, cleanup)
	}
	if (instance.effectLifecycle === lifecycle) syncMountedDeps(state, instance)
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
	state.phase.releases = []
	settle(state, primitives, mounts, reconciles, mountWrites)
	for (const instance of effects) {
		effects.delete(instance)
		if (instance.mountCount === 0) continue
		let changed = !instance.effectLifecycle
		for (const [dep, version] of dependencyVersions(instance)) {
			peekInstance(state, dep)
			if (dep.version !== version) changed = true
		}
		if (changed) runEffect(state, instance, mounts, reconciles, mountWrites)
		settle(state, new Map(), mounts, reconciles, mountWrites)
	}
	state.phase.effects = undefined
	state.phase.releases = undefined
	state.phase.mounts = undefined
	state.phase.reconciles = undefined
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

/**
 * Mounts, dependencies first, every retained instance reachable from
 * `instance` through retained dependencies that is not mounted yet, whether or
 * not it is queued in `mounts`. After each mount, every ancestor on the current
 * path re-walks its dependencies, since `onMount` may change the graph. A
 * dependency mounted for one root can be cleaned up in the same flush if a later
 * root's `onMount` write unlinks it.
 */
function settleMount(
	state: StoreState,
	instance: Instance<any>,
	mounts: Set<Instance<any>>,
	mountWrites: Map<Instance<any>, any>,
) {
	const visited = new Set<Instance<any>>()
	/**
	 * Returns whether the caller must re-walk because a mount ran (user code
	 * may have changed the graph).
	 */
	const walk = (node: Instance<any>): boolean => {
		if (visited.has(node)) return false
		visited.add(node)
		if (node.mountCount === 0 || node.symbol.type === 'effect') {
			mounts.delete(node)
			return false
		}
		const walkDependencies = () => {
			peekInstance(state, node)
			for (const dep of dependencies(node)) if (walk(dep)) return true
			return false
		}
		let dependencyRequestedRewalk = false
		while (walkDependencies()) {
			dependencyRequestedRewalk = true
			visited.clear()
			visited.add(node)
		}
		mounts.delete(node)
		if (node.mountLifecycle) return dependencyRequestedRewalk
		isoAssert(mountWrites.size === 0)
		state.phase.mountWrites = mountWrites
		mount(state, node)
		state.phase.mountWrites = undefined
		applyUpdates(state, mountWrites)
		return true
	}
	walk(instance)
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
	const releases = state.phase.releases
	isoAssert(releases)
	const idle = () =>
		mountWrites.size === 0 && mounts.size === 0 && reconciles.size === 0
	applyUpdates(state, primitives)
	do {
		applyUpdates(state, mountWrites)
		for (const instance of reconciles) reconcile(state, instance, reconciles)
		for (const instance of mounts)
			settleMount(state, instance, mounts, mountWrites)
		if (idle()) for (const dep of releases.splice(0)) release(state, dep)
	} while (!idle() || releases.length > 0)
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
