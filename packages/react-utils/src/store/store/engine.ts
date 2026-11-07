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
 * A nested retain during that peek is counted by the post-increment.
 */
export function retain<S>(state: StoreState, instance: Instance<S>) {
	if (instance.mountCount === 0) {
		cancelEviction(state, instance)
		if (instance.symbol.type === 'effect') resetDependencies(instance)
		else peekInstance(state, instance)
	}
	if (instance.mountCount++ > 0) return
	syncMountedDeps(state, instance)
	isoAssert(instance.mountCount > 0)
	queueMount(state, instance)
	queueEffect(state, instance)
}

export function release<S>(state: StoreState, instance: Instance<S>) {
	if (--instance.mountCount > 0) return
	const mountedDeps = detachMountedEdges(instance)
	teardown(state, instance)
	if (instance.familyEntry) queueEviction(state, instance)
	for (const dep of mountedDeps) release(state, dep)
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

function unlink<S>(
	state: StoreState,
	instance: Instance<S>,
	dep: Instance<any>,
) {
	if (!hasMountedDependency(instance, dep)) return
	const visited = new Set<Instance<any>>()
	const staleConsumer = (consumer: Instance<any>): boolean => {
		if (visited.has(consumer)) return false
		visited.add(consumer)
		if (
			consumer.symbol.type === 'derived' &&
			consumer.freshness.type !== 'clean'
		)
			return true
		for (const sub of consumers(consumer)) if (staleConsumer(sub)) return true
		return false
	}
	const stale = staleConsumer(instance)
	removeMountedEdge(instance, dep)
	if (stale && hasLiveResource(dep)) {
		isoAssert(state.phase.releases, 'stale consumer outside settle')
		state.phase.releases.push(dep)
	} else release(state, dep)
}

function hasLiveResource(
	instance: Instance<any>,
	visited = new Set<Instance<any>>(),
): boolean {
	if (visited.has(instance)) return false
	visited.add(instance)
	if (instance.mountLifecycle || instance.effectLifecycle) return true
	for (const dep of mountedDependencies(instance))
		if (hasLiveResource(dep, visited)) return true
	return false
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
		for (const parent of current.owners.keys()) walk(parent)
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
		const references = child.owners.get(owner)!
		if (references === 1) child.owners.delete(owner)
		else child.owners.set(owner, references - 1)
		release(state, child)
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
	runCleanup(state, instance, cleanup)
}

export function runCleanup(
	state: StoreState,
	instance: Instance<any>,
	cleanup: (() => void) | undefined,
) {
	if (cleanup === undefined) return
	if (state.instrumentation) countOperation(state, 'cleanups', instance.symbol)
	cleanup()
}

export function peekInstance<S>(state: StoreState, instance: Instance<S>) {
	isoAssert(instance.freshness.type !== 'evaluating', 'cyclic atom dependency')
	const { symbol } = instance
	isoAssert(symbol.type !== 'effect', 'effect atoms have no value')
	if (symbol.type === 'derived' && instance.freshness.type !== 'dirty') {
		if (isFresh(state, instance)) return instance.value
		revalidateUnmounted(state, instance)
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
		if (state.instrumentation) countOperation(state, 'getters', symbol)
		const next = symbol.getter(read)
		instance.value = next
		if (!Object.is(next, previous)) advanceDerivedVersion(state, instance)
		instance.freshness = { type: 'clean', validatedAt: state.epoch }
		if (instance.mountCount > 0) syncMountedDeps(state, instance)
		return instance.value
	}
	return instance.value
}

/**
 * Whether the instance is mounted or already validated at the current
 * epoch. It must be re-checked after `depsAreCurrent`, because nested
 * peeks can mount or revalidate the instance.
 */
function isFresh<S>(state: StoreState, instance: Instance<S>) {
	return (
		instance.mountCount > 0 ||
		(instance.freshness.type === 'clean' &&
			instance.freshness.validatedAt === state.epoch)
	)
}

function revalidateUnmounted<S>(state: StoreState, instance: Instance<S>) {
	isoAssert(instance.freshness.type === 'clean')
	const current = depsAreCurrent(state, instance)
	if (isFresh(state, instance)) return
	if (current) instance.freshness = { type: 'clean', validatedAt: state.epoch }
	else instance.freshness = { type: 'dirty' }
}

function depsAreCurrent<S>(state: StoreState, instance: Instance<S>) {
	if (state.instrumentation)
		countOperation(state, 'validations', instance.symbol)
	for (const [dep, version] of dependencyVersions(instance)) {
		if (dep.version !== version) return false
		peekInstance(state, dep)
		if (dep.version !== version) return false
	}
	return true
}
