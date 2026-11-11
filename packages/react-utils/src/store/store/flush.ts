import { exhaustive, isoAssert } from '../../functions'
import { type Read, type MountEffect } from '../atoms'
import { associateUntrackedRead } from '../effectRead'
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

/**
 * Marks derived consumers of a changed primitive dirty and the other reachable
 * derived instances `check`, so they rerun only if a dependency's version
 * changed. A `check` instance reached again from a primitive becomes dirty.
 */
function invalidate<S>(
	state: StoreState,
	instance: Instance<S>,
	affected: Set<Instance<any>>,
) {
	if (affected.has(instance)) return
	affected.add(instance)
	countOperation(state, 'invalidations', instance.symbol)
	if (instance.mountCount > 0) {
		queueReconcile(state, instance)
		queueEffect(state, instance)
	}
	const isSource = instance.symbol.type === 'primitive'
	for (const sub of consumers(instance)) {
		if (sub.symbol.type === 'derived') {
			if (isSource) sub.freshness = { type: 'dirty' }
			else if (sub.freshness.type === 'clean') sub.freshness = { type: 'check' }
		}
		invalidate(state, sub, affected)
	}
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
	countOperation(state, 'effects', instance.symbol)
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
	associateUntrackedRead(read, state.read)
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
 * Mounts retained dependencies before their consumers, including dependencies
 * below already-mounted nodes. Completed walks are shared until a write or
 * retention change invalidates them. A later root can still unlink and clean up
 * a dependency mounted earlier in the same flush. Revision changes made by
 * `peekInstance` need no re-walk: the dependencies it links are walked
 * immediately after, and the ones it unlinks no longer need a walk from this
 * node.
 */
function settleMount(
	state: StoreState,
	mounts: Set<Instance<any>>,
	mountWrites: Map<Instance<any>, any>,
) {
	const visited = new Set<Instance<any>>()
	const visiting = new Set<Instance<any>>()
	let revision = state.mountRevision
	/** Returns whether a graph change requires the caller to re-walk. */
	const walk = (node: Instance<any>): boolean => {
		state.mountWalks++
		if (revision !== state.mountRevision) {
			visited.clear()
			visiting.clear()
			revision = state.mountRevision
		}
		if (visited.has(node) || visiting.has(node)) return false
		visiting.add(node)
		if (node.mountCount === 0 || node.symbol.type === 'effect') {
			mounts.delete(node)
			visiting.delete(node)
			return false
		}
		const walkDependencies = () => {
			peekInstance(state, node)
			for (const dep of dependencies(node)) if (walk(dep)) return true
			return false
		}
		let dependencyRequestedRewalk = false
		while (walkDependencies()) dependencyRequestedRewalk = true
		mounts.delete(node)
		const before = state.mountRevision
		if (!node.mountLifecycle) {
			isoAssert(mountWrites.size === 0)
			state.phase.mountWrites = mountWrites
			mount(state, node)
			state.phase.mountWrites = undefined
			applyUpdates(state, mountWrites)
		}
		visiting.delete(node)
		if (before !== state.mountRevision) return true
		visited.add(node)
		return dependencyRequestedRewalk
	}
	for (const instance of mounts) walk(instance)
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
		for (const instance of reconciles) reconcile(state, instance, reconciles)
		settleMount(state, mounts, mountWrites)
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
