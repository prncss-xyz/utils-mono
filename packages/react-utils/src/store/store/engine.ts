import { isoAssert } from '../../functions'
import { type AtomFamily, type AtomSymbol, type Read } from '../atoms'
import {
	dependencies,
	dependencyVersions,
	hasDependency,
	dependencyCount,
	consumers,
	mountedDependencies,
	hasMountedDependency,
	mountedDependencyCount,
	resetDependencies,
	recordDependency,
	addMountedEdge,
	removeMountedEdge,
	detachMountedEdges,
	owners,
	ownerReferences,
	releaseOwner,
} from './graph'
import { getInstance } from './registry'
import {
	type StoreState,
	queueMount,
	queueEffect,
	queueEviction,
	cancelEviction,
	advanceDerivedVersion,
	countOperation,
} from './state'
import { type Instance, type MountLifecycle } from './types'

/**
 * `peekInstance` must run while the instance is still unmounted, so that a
 * stale unmounted cache is revalidated before it starts receiving updates.
 * A nested retain during that peek is counted by the post-increment. An
 * instance retained again before its deferred teardown keeps its mount
 * lifecycle, and its children resume the runs they skipped meanwhile.
 */
export function retain<S>(state: StoreState, instance: Instance<S>) {
	if (instance.mountCount === 0) {
		cancelEviction(state, instance)
		if (instance.symbol.type === 'effect') resetDependencies(instance)
		else peekInstance(state, instance)
	}
	if (instance.mountCount++ > 0) return
	state.mountRevision++
	syncMountedDeps(state, instance)
	isoAssert(instance.mountCount > 0)
	queueMount(state, instance)
	queueEffect(state, instance)
	if (instance.mountLifecycle) requeueChildren(state, instance.mountLifecycle)
}

function requeueChildren(state: StoreState, lifecycle: MountLifecycle) {
	for (const child of lifecycle.children) {
		queueEffect(state, child)
		if (child.effectLifecycle) requeueChildren(state, child.effectLifecycle)
	}
}

/**
 * Within a flush, every release on behalf of `holder`, a consumer or an
 * owner, records the dropped edge, which orders the deferred teardowns.
 *
 * Within a flush, an instance that such a release leaves unmounted with a
 * mount lifecycle from its `onMount` keeps it until `drainTeardowns`, so
 * that one retained again in the same flush is not unmounted and mounted
 * again. Without `onMount`, the teardown has no observable effect and runs at
 * once. The last release by a subscription or an effect handle follows the
 * same rule while a mount or an effect is still queued, since either may
 * retain the instance again. Otherwise it tears down the instance at once,
 * after the deferred teardowns, so that consumers still go first; what it
 * leaves unmounted follows the rule above.
 */
export function release<S>(
	state: StoreState,
	instance: Instance<S>,
	holder?: Instance<any>,
) {
	const { teardowns } = state.phase
	const mayRetainAgain =
		teardowns !== undefined && (holder !== undefined || hasQueuedWork(state))
	if (teardowns) {
		if (holder) recordDroppedEdge(state, holder, instance)
		else if (instance.mountCount === 1 && !hasQueuedWork(state))
			drainTeardowns(state)
	}
	if (--instance.mountCount > 0) return
	state.mountRevision++
	const mountedDeps = detachMountedEdges(instance)
	if (
		mayRetainAgain &&
		instance.mountLifecycle &&
		instance.symbol.type !== 'effect' &&
		instance.symbol.onMount
	)
		teardowns.push(instance)
	else teardown(state, instance)
	if (instance.familyEntry) queueEviction(state, instance)
	for (const dep of mountedDeps) release(state, dep, instance)
}

function hasQueuedWork(state: StoreState) {
	const { mounts, effects } = state.phase
	isoAssert(mounts && effects)
	return mounts.size > 0 || effects.size > 0
}

function recordDroppedEdge(
	state: StoreState,
	holder: Instance<any>,
	instance: Instance<any>,
) {
	const { droppedEdges } = state.phase
	isoAssert(droppedEdges)
	droppedEdges.push(holder, instance)
}

/**
 * Whether only owners released in this flush, whose teardown is deferred,
 * still retain the effect, directly or through other such effects.
 */
export function isOrphaned(instance: Instance<any>): boolean {
	return heldOnlyByOwners(instance) && isOrphanedWith(instance, new Map())
}

function heldOnlyByOwners(instance: Instance<any>) {
	let references = 0
	for (const [, count] of ownerReferences(instance)) references += count
	return references === instance.mountCount
}

/** `memo` keeps each owner effect checked once when owners share ancestors. */
function isOrphanedWith(
	instance: Instance<any>,
	memo: Map<Instance<any>, boolean>,
): boolean {
	if (!heldOnlyByOwners(instance)) return false
	const known = memo.get(instance)
	if (known !== undefined) return known
	let orphaned = true
	for (const owner of owners(instance)) {
		if (owner.mountCount === 0) continue
		if (owner.symbol.type !== 'effect' || !isOrphanedWith(owner, memo)) {
			orphaned = false
			break
		}
	}
	memo.set(instance, orphaned)
	return orphaned
}

/**
 * Tears down the instances whose teardown `release` deferred and that are
 * still unmounted. Several are torn down in one pass over what they reach,
 * consumers and owners first, which also tears down in order the instances
 * whose teardown the pass itself defers.
 */
export function drainTeardowns(state: StoreState) {
	const { teardowns, droppedEdges } = state.phase
	isoAssert(teardowns && droppedEdges)
	const pending = teardowns.splice(0).filter(isPendingTeardown)
	const order =
		pending.length > 1 ? consumersFirst(pending, droppedEdges) : pending
	for (const instance of order)
		if (isPendingTeardown(instance)) teardown(state, instance)
}

function isPendingTeardown(instance: Instance<any>) {
	return instance.mountCount === 0 && instance.mountLifecycle !== undefined
}

/**
 * The instances reached from `roots` through mounted edges, owned children
 * and the edges dropped in this flush, each before the instances it reaches.
 */
function consumersFirst(roots: Instance<any>[], droppedEdges: Instance<any>[]) {
	const dropped = new Map<Instance<any>, Instance<any>[]>()
	for (let index = 0; index < droppedEdges.length; index += 2) {
		const holder = droppedEdges[index]!
		const instance = droppedEdges[index + 1]!
		const held = dropped.get(holder)
		if (held) held.push(instance)
		else dropped.set(holder, [instance])
	}
	const order: Instance<any>[] = []
	const visited = new Set<Instance<any>>()
	const visit = (instance: Instance<any>) => {
		if (visited.has(instance)) return
		visited.add(instance)
		for (const dep of mountedDependencies(instance)) visit(dep)
		const lifecycle = instance.mountLifecycle ?? instance.effectLifecycle
		for (const child of lifecycle?.children ?? []) visit(child)
		for (const held of dropped.get(instance) ?? []) visit(held)
		order.push(instance)
	}
	for (const root of roots) visit(root)
	return order.reverse()
}

export function syncMountedDeps<S>(state: StoreState, instance: Instance<S>) {
	let linked = false
	for (const dep of dependencies(instance)) {
		isoAssert(instance.mountCount > 0)
		if (hasMountedDependency(instance, dep)) continue
		link(state, instance, dep)
		linked = true
	}
	if (!linked && dependencyCount(instance) === mountedDependencyCount(instance))
		return
	for (const dep of mountedDependencies(instance)) {
		if (hasDependency(instance, dep)) continue
		pruneMountedDeps(state, instance)
		return
	}
}

function pruneMountedDeps<S>(state: StoreState, instance: Instance<S>) {
	for (const dep of Array.from(mountedDependencies(instance))) {
		if (instance.mountCount === 0) return
		if (!hasDependency(instance, dep)) unlink(state, instance, dep)
	}
}

export function link<S>(
	state: StoreState,
	instance: Instance<S>,
	dep: Instance<any>,
) {
	assertOwnershipEdge(instance, dep)
	addMountedEdge(instance, dep)
	retain(state, dep)
}

/**
 * Releases the dependency at once but defers the teardown of what it leaves
 * unmounted. An instance unlinks only after recomputing within a flush, and
 * until that flush settles any mounted instance may still read the dependency
 * again: a consumer of the instance marked by the same invalidation, another
 * subscription root, or a queued effect. Releasing at once keeps an instance
 * that no mounted instance reads out of reconciliation.
 */
function unlink<S>(
	state: StoreState,
	instance: Instance<S>,
	dep: Instance<any>,
) {
	if (!hasMountedDependency(instance, dep)) return
	isoAssert(instance.freshness.type === 'clean')
	isoAssert(state.phase.teardowns, 'unlink outside flush')
	removeMountedEdge(instance, dep)
	release(state, dep, instance)
}

export function assertOwnershipEdge(
	owner: Instance<any>,
	target: Instance<any>,
) {
	const visited = new Set<Instance<any>>()
	const walk = (current: Instance<any>) => {
		isoAssert(current !== target, 'cyclic effect ownership')
		if (visited.has(current)) return
		visited.add(current)
		for (const parent of owners(current)) walk(parent)
		for (const consumer of consumers(current)) walk(consumer)
	}
	walk(owner)
}

export function releaseChildren(
	state: StoreState,
	owner: Instance<any>,
	lifecycle: MountLifecycle,
) {
	while (lifecycle.children.length > 0) {
		const child = lifecycle.children.pop()!
		releaseOwner(child, owner)
		release(state, child, owner)
	}
}

function teardown(state: StoreState, instance: Instance<any>) {
	const lifecycle = instance.effectLifecycle ?? instance.mountLifecycle
	instance.effectLifecycle = undefined
	instance.mountLifecycle = undefined
	if (!lifecycle) return
	lifecycle.active = false
	releaseChildren(state, instance, lifecycle)
	const cleanup = lifecycle.cleanup
	lifecycle.cleanup = undefined
	callCleanup(state, instance, cleanup)
}

export function callCleanup(
	state: StoreState,
	instance: Instance<any>,
	cleanup: (() => void) | undefined,
) {
	if (cleanup === undefined) return
	countOperation(state, 'cleanups', instance.symbol)
	cleanup()
}

export function peekInstance<S>(state: StoreState, instance: Instance<S>) {
	isoAssert(instance.freshness.type !== 'evaluating', 'cyclic atom dependency')
	const { symbol } = instance
	isoAssert(symbol.type !== 'effect', 'effect atoms have no value')
	if (symbol.type === 'derived' && instance.freshness.type !== 'dirty') {
		if (isFresh(state, instance)) return instance.value
		revalidate(state, instance)
	}
	if (instance.freshness.type === 'dirty') {
		isoAssert(symbol.type === 'derived')
		instance.freshness = { type: 'evaluating' }
		resetDependencies(instance)
		const read = (<T, Key, Args extends unknown[]>(
			target: AtomFamily<T, Key, Args> | AtomSymbol<T, Args>,
			key?: Key,
		) => {
			const dep = getInstance(state, target, key)
			const value = peekInstance(state, dep)
			recordDependency(instance, dep, dep.version)
			return value
		}) as Read
		const previous = instance.value
		countOperation(state, 'getters', symbol)
		state.evaluatingGetters++
		const next = symbol.getter(read)
		state.evaluatingGetters--
		instance.value = next
		if (!Object.is(next, previous)) advanceDerivedVersion(state, instance)
		instance.freshness = { type: 'clean', validatedAt: state.epoch }
		if (instance.mountCount > 0) syncMountedDeps(state, instance)
		return instance.value
	}
	return instance.value
}

/**
 * Whether the instance is clean and either mounted or already validated at
 * the current epoch. It must be re-checked after `depsAreCurrent`, because
 * nested peeks can mount or revalidate the instance.
 */
function isFresh<S>(state: StoreState, instance: Instance<S>) {
	return (
		instance.freshness.type === 'clean' &&
		(instance.mountCount > 0 || instance.freshness.validatedAt === state.epoch)
	)
}

/** Settles a `check` instance, or an unmounted one not validated this epoch. */
function revalidate<S>(state: StoreState, instance: Instance<S>) {
	isoAssert(
		instance.freshness.type === 'clean' || instance.freshness.type === 'check',
	)
	const current = depsAreCurrent(state, instance)
	if (isFresh(state, instance)) return
	if (current) instance.freshness = { type: 'clean', validatedAt: state.epoch }
	else instance.freshness = { type: 'dirty' }
}

function depsAreCurrent<S>(state: StoreState, instance: Instance<S>) {
	countOperation(state, 'validations', instance.symbol)
	for (const [dep, version] of dependencyVersions(instance)) {
		if (dep.version !== version) return false
		peekInstance(state, dep)
		if (dep.version !== version) return false
	}
	return true
}
