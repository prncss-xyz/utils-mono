import { exhaustive, isoAssert } from '../../functions'
import { type Read, type MountEffect } from '../atoms'
import { associateUntrackedRead } from '../effectRead'
import {
	peekInstance,
	retain,
	link,
	syncMountedDeps,
	releaseChildren,
	drainTeardowns,
	isOrphaned,
	callCleanup,
	assertOwnershipEdge,
} from './engine'
import {
	addOwner,
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
	queueEffect,
	publishChange,
	countOperation,
	dropPendingValues,
	recycleTasks,
	resolveSettled,
} from './state'
import { type Delivery, type Instance, type MountLifecycle } from './types'

/**
 * Marks derived consumers of a changed primitive dirty and the other reachable
 * derived instances `check`, so they rerun only if a dependency's version
 * changed. A `check` instance reached again from a primitive becomes dirty.
 * Collects the reached mounted derived instances in `reconciles`.
 */
function invalidate<S>(
	state: StoreState,
	instance: Instance<S>,
	affected: Set<Instance<any>>,
	reconciles: Set<Instance<any>>,
) {
	const stack = [invalidateInstance(state, instance, affected, reconciles)]
	while (stack.length > 0) {
		const next = stack[stack.length - 1]!.next()
		if (next.done) stack.pop()
		else stack.push(invalidateInstance(state, next.value, affected, reconciles))
	}
}

function* invalidateInstance(
	state: StoreState,
	instance: Instance<any>,
	affected: Set<Instance<any>>,
	reconciles: Set<Instance<any>>,
) {
	if (affected.has(instance)) return
	affected.add(instance)
	countOperation(state, 'invalidations', instance.symbol)
	if (instance.mountCount > 0) {
		if (instance.symbol.type === 'derived') reconciles.add(instance)
		queueEffect(state, instance)
	}
	const isSource = instance.symbol.type === 'primitive'
	for (const sub of consumers(instance)) {
		if (sub.symbol.type === 'derived') {
			if (isSource) sub.freshness = { type: 'dirty' }
			else if (sub.freshness.type === 'clean') sub.freshness = { type: 'check' }
		}
		yield sub
	}
}

/**
 * Brings the mounted derived instances reached from the changed roots up to
 * date, then delivers to a snapshot of subscription registrations taken
 * before that evaluation, only for instances whose value changed: the
 * committed roots, and the derived instances whose version advanced. A
 * registration removed or replaced before its turn is skipped; one created
 * during evaluation or delivery (including a re-subscription by the same
 * callback) waits for a later notification.
 */
function propagateChanges(state: StoreState, roots: Instance<any>[]) {
	const affected = new Set<Instance<any>>()
	const reconciles = new Set<Instance<any>>()
	for (const root of roots) invalidate(state, root, affected, reconciles)
	const deliveries: Delivery[] = []
	for (const instance of affected) {
		const { subscriptions } = instance
		if (subscriptions)
			for (const [callback, registration] of subscriptions)
				deliveries.push({
					instance,
					callback,
					registration,
					version: instance.version,
				})
	}
	for (const instance of reconciles) reconcile(state, instance, reconciles)
	const committed = new Set(roots)
	for (const { instance, callback, registration, version } of deliveries) {
		isoAssert(instance.subscriptions)
		if (
			instance.subscriptions.get(callback) === registration &&
			(committed.has(instance) || instance.version !== version)
		) {
			countOperation(state, 'notifications', instance.symbol)
			callback()
		}
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
		addOwner(child, owner)
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
		else callCleanup(state, instance, cleanup)
	}
}

function runEffect(
	state: StoreState,
	instance: Instance<any>,
	mounts: Set<Instance<any>>,
) {
	isoAssert(instance.symbol.type === 'effect')
	const previous = instance.effectLifecycle
	if (previous) {
		const cleanup = previous.cleanup
		previous.cleanup = undefined
		callCleanup(state, instance, cleanup)
		releaseChildren(state, instance, previous)
		if (
			instance.effectLifecycle !== previous ||
			instance.mountCount === 0 ||
			isOrphaned(instance)
		)
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
			dropPendingValues(state)
			settle(state, mounts, false)
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
		else callCleanup(state, instance, cleanup)
	}
	if (instance.effectLifecycle === lifecycle) syncMountedDeps(state, instance)
}

export function flush(state: StoreState) {
	const { tasks } = state
	isoAssert(tasks, 'unexpected call to flush')
	const { mounts, primitives, effects, pendingFamilyEvictions } = tasks
	state.tasks = undefined
	state.phase.mounts = mounts
	state.phase.effects = effects
	state.phase.familyEvictions = pendingFamilyEvictions
	state.phase.teardowns = []
	state.phase.droppedEdges = []
	applyUpdates(state, primitives)
	settle(state, mounts, true)
	for (const instance of effects) {
		effects.delete(instance)
		if (instance.mountCount > 0 && !isOrphaned(instance)) {
			let changed = !instance.effectLifecycle
			for (const [dep, version] of dependencyVersions(instance)) {
				peekInstance(state, dep)
				if (dep.version !== version) changed = true
			}
			if (changed) runEffect(state, instance, mounts)
		}
		dropPendingValues(state)
		settle(state, mounts, true)
	}
	state.phase.effects = undefined
	state.phase.teardowns = undefined
	state.phase.droppedEdges = undefined
	state.phase.mounts = undefined
	scheduleEvictions(state, pendingFamilyEvictions)
	recycleTasks(state, tasks)
	resolveSettled(state)
}

function applyUpdates(state: StoreState, pending: Map<Instance<any>, any>) {
	dropPendingValues(state)
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
		propagateChanges(state, changed)
	}
}

type MountWalk = {
	mountWrites: Map<Instance<any>, any> | undefined
	visited: Set<Instance<any>>
	visiting: Set<Instance<any>>
	revision: number
}

function* walkMount(
	state: StoreState,
	mounts: Set<Instance<any>>,
	walk: MountWalk,
	node: Instance<any>,
): Generator<Instance<any>, boolean, boolean> {
	state.mountWalks++
	if (walk.revision !== state.mountRevision) {
		walk.visited.clear()
		walk.visiting.clear()
		walk.revision = state.mountRevision
	}
	if (walk.visited.has(node) || walk.visiting.has(node)) return false
	walk.visiting.add(node)
	if (node.mountCount === 0 || node.symbol.type === 'effect') {
		mounts.delete(node)
		walk.visiting.delete(node)
		return false
	}
	let dependencyRequestedRewalk = false
	while (true) {
		isoAssert(node.freshness.type === 'clean')
		let rewalk = false
		for (const dep of dependencies(node)) {
			if (yield dep) {
				rewalk = true
				break
			}
		}
		if (!rewalk) break
		dependencyRequestedRewalk = true
		if (node.mountCount === 0) break
	}
	mounts.delete(node)
	const before = state.mountRevision
	if (!node.mountLifecycle) {
		walk.mountWrites ??= new Map()
		isoAssert(walk.mountWrites.size === 0)
		state.phase.mountWrites = walk.mountWrites
		mount(state, node)
		state.phase.mountWrites = undefined
		applyUpdates(state, walk.mountWrites)
	}
	walk.visiting.delete(node)
	if (before !== state.mountRevision) return true
	walk.visited.add(node)
	return dependencyRequestedRewalk
}

/**
 * Mounts retained dependencies before their consumers, including dependencies
 * below already-mounted nodes. Completed walks are shared until a write or
 * retention change invalidates them. A later root can still unlink and clean up
 * a dependency mounted earlier in the same flush. A node still mounted is
 * clean: `retain` validates it, and every later commit reconciles the mounted
 * instances it reaches before the walk resumes. A commit can also release the
 * node being walked, which ends its walk.
 */
function settleMount(state: StoreState, mounts: Set<Instance<any>>) {
	if (mounts.size === 0) return
	const walk: MountWalk = {
		mountWrites: undefined,
		visited: new Set(),
		visiting: new Set(),
		revision: state.mountRevision,
	}
	for (const instance of mounts) {
		const stack = [walkMount(state, mounts, walk, instance)]
		let rewalk = false
		while (stack.length > 0) {
			const next = stack[stack.length - 1]!.next(rewalk)
			if (next.done) {
				stack.pop()
				rewalk = next.value
			} else {
				stack.push(walkMount(state, mounts, walk, next.value))
				rewalk = false
			}
		}
	}
}

function reconcile(
	state: StoreState,
	instance: Instance<any>,
	reconciles: Set<Instance<any>>,
) {
	const stack = [reconcileInstance(state, instance, reconciles)]
	while (stack.length > 0) {
		const next = stack[stack.length - 1]!.next()
		if (next.done) stack.pop()
		else stack.push(reconcileInstance(state, next.value, reconciles))
	}
}

function* reconcileInstance(
	state: StoreState,
	instance: Instance<any>,
	reconciles: Set<Instance<any>>,
) {
	if (!reconciles.delete(instance)) return
	yield* Array.from(consumers(instance))
	if (instance.mountCount > 0) peekInstance(state, instance)
}

/**
 * Mounts until idle. With `runTeardowns`, it also runs the teardowns that
 * `release` deferred, once no effect is queued. An effect body passes false,
 * since it may still read the released instances again.
 */
function settle(
	state: StoreState,
	mounts: Set<Instance<any>>,
	runTeardowns: boolean,
) {
	const { teardowns, effects } = state.phase
	isoAssert(teardowns)
	isoAssert(effects)
	while (true) {
		settleMount(state, mounts)
		if (mounts.size > 0) continue
		if (!runTeardowns || effects.size > 0 || teardowns.length === 0) break
		drainTeardowns(state)
	}
}

function scheduleEvictions(
	state: StoreState,
	pendingFamilyEvictions: Set<Instance<any>>,
) {
	for (const instance of pendingFamilyEvictions) {
		pendingFamilyEvictions.delete(instance)
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
