import { isoAssert } from '../../functions'
import { type AtomFamily, type AtomSymbol, type Read } from '../atoms'
import { getCleanupOrder, unownedComponent } from './cleanupOrder'
import {
	dependencies,
	dependencyVersions,
	hasDependency,
	dependencyCount,
	consumers,
	mountedDependencies,
	hasMountedDependency,
	mountedDependencyCount,
	deferredOwners,
	resetDependencies,
	recordDependency,
	addMountedEdge,
	removeMountedEdge,
	detachMountedEdges,
	addDeferredOwner,
	removeDeferredOwner,
} from './graph'
import { getInstance } from './registry'
import {
	type StoreState,
	queueMount,
	queueEffect,
	queueEviction,
	cancelEviction,
	advanceDerivedVersion,
} from './state'
import {
	type DeferredRelease,
	type EffectLifecycle,
	type Instance,
	type MountLifecycle,
} from './types'

/**
 * `peekInstance` must run while the instance is still unmounted, so that a
 * stale unmounted cache is revalidated before it starts receiving updates.
 * A nested retain during that peek is counted by the post-increment.
 */
export function retain<S>(state: StoreState, instance: Instance<S>) {
	if (instance.mountCount === 0) {
		cancelEviction(state, instance)
		peekInstance(state, instance)
	}
	if (instance.mountCount++ > 0) return
	syncMountedDeps(state, instance)
	if (instance.mountCount === 0) return
	queueMount(state, instance)
	queueEffect(state, instance)
}

export function release<S>(state: StoreState, instance: Instance<S>) {
	if (--instance.mountCount > 0) {
		releaseUnowned(state, instance)
		return
	}
	const mountedDeps = detachMountedEdges(instance)
	teardown(state, instance)
	if (instance.familyEntry) queueEviction(state, instance)
	for (const dep of mountedDeps) release(state, dep)
}

function syncMountedDeps<S>(state: StoreState, instance: Instance<S>) {
	let linked = false
	for (const dep of dependencies(instance)) {
		if (instance.mountCount === 0) return
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

function link<S>(state: StoreState, instance: Instance<S>, dep: Instance<any>) {
	isoAssert(!hasMountedDependency(instance, dep))
	addMountedEdge(instance, dep)
	retain(state, dep)
}

function unlink<S>(
	state: StoreState,
	instance: Instance<S>,
	dep: Instance<any>,
) {
	if (!hasMountedDependency(instance, dep)) return
	const owners = new Set<EffectLifecycle<any>>()
	const visited = new Set<Instance<any>>()
	const collect = (consumer: Instance<any>) => {
		if (visited.has(consumer)) return
		visited.add(consumer)
		const lifecycle = consumer.effectLifecycle
		if (lifecycle && (lifecycle.cleanup || lifecycle.cleaning))
			owners.add(lifecycle)
		for (const deferred of deferredOwners(consumer))
			for (const owner of deferred.owners) owners.add(owner)
		for (const sub of consumers(consumer)) collect(sub)
	}
	collect(instance)
	removeMountedEdge(instance, dep)
	if (owners.size === 0) release(state, dep)
	else {
		const deferred: DeferredRelease = { dependency: dep, owners }
		addDeferredOwner(dep, deferred)
		for (const owner of owners) owner.deferredReleases.add(deferred)
	}
}

function releaseUnowned(state: StoreState, instance: Instance<any>) {
	const component = unownedComponent(instance)
	if (!component) return
	const order = getCleanupOrder(component)
	for (let index = order.length - 1; index >= 0; index--) {
		const consumer = order[index]!
		if (consumer.mountCount === 0 || !unownedComponent(consumer)) continue
		teardown(state, consumer)
		if (consumer.mountCount > 0) {
			queueMount(state, consumer)
			queueEffect(state, consumer)
		}
	}
}

function teardown(state: StoreState, instance: Instance<any>) {
	const effectLifecycle = instance.effectLifecycle
	const mountLifecycle = instance.mountLifecycle
	instance.effectLifecycle = undefined
	instance.mountLifecycle = undefined
	if (effectLifecycle) cleanupEffect(state, effectLifecycle, mountLifecycle)
	else mountLifecycle?.cleanup?.()
}

export function cleanupEffect(
	state: StoreState,
	lifecycle: EffectLifecycle<any>,
	mountLifecycle?: MountLifecycle,
) {
	if (lifecycle.cleaning) {
		mountLifecycle?.cleanup?.()
		return
	}
	const cleanup = lifecycle.cleanup
	lifecycle.cleanup = undefined
	lifecycle.cleaning = true
	cleanup?.()
	mountLifecycle?.cleanup?.()
	for (const deferred of lifecycle.deferredReleases) {
		lifecycle.deferredReleases.delete(deferred)
		deferred.owners.delete(lifecycle)
		if (deferred.owners.size === 0) {
			removeDeferredOwner(deferred.dependency, deferred)
			release(state, deferred.dependency)
		}
	}
	lifecycle.dependencies.clear()
	lifecycle.cleaning = false
}

export function peekInstance<S>(state: StoreState, instance: Instance<S>) {
	isoAssert(instance.freshness.type !== 'evaluating', 'cyclic atom dependency')
	const { symbol } = instance
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
	if (instance.freshness.type === 'dirty' || isFresh(state, instance)) return
	const current = depsAreCurrent(state, instance)
	if (isFresh(state, instance)) return
	if (current) instance.freshness = { type: 'clean', validatedAt: state.epoch }
	else instance.freshness = { type: 'dirty' }
}

function depsAreCurrent<S>(state: StoreState, instance: Instance<S>) {
	state.validations++
	for (const [dep, version] of dependencyVersions(instance)) {
		if (dep.version !== version) return false
		peekInstance(state, dep)
		if (dep.version !== version) return false
	}
	return true
}
