import { isoAssert } from '../../functions'
import { type AtomFamily, type AtomSymbol, type Read } from '../atoms'
import { getCleanupOrder, unownedComponent } from './cleanupOrder'
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
	const mountedDeps = detachMountedDeps(state, instance)
	teardown(state, instance)
	if (instance.familyEntry) queueEviction(state, instance)
	for (const dep of mountedDeps) release(state, dep)
}

function syncMountedDeps<S>(state: StoreState, instance: Instance<S>) {
	for (const dep of instance.depVersions.keys()) {
		if (instance.mountCount === 0) return
		link(state, instance, dep)
	}
	// Releasing a dependency can run user cleanup that changes this graph.
	for (const dep of Array.from(instance.mountedDeps)) {
		if (instance.mountCount === 0) return
		if (instance.depVersions.has(dep)) continue
		unlink(state, instance, dep)
	}
}

/**
 * Swaps out the mounted dependency set and clears the reverse links. It
 * must run before any user callback can change dependencies or remount.
 */
function detachMountedDeps<S>(state: StoreState, instance: Instance<S>) {
	const mountedDeps = instance.mountedDeps
	instance.mountedDeps = new Set()
	for (const dep of mountedDeps) dep.mountedSubs.delete(instance)
	return mountedDeps
}

function link<S>(state: StoreState, instance: Instance<S>, dep: Instance<any>) {
	if (instance.mountedDeps.has(dep)) return
	instance.mountedDeps.add(dep)
	dep.mountedSubs.add(instance)
	retain(state, dep)
}

function unlink<S>(
	state: StoreState,
	instance: Instance<S>,
	dep: Instance<any>,
) {
	if (!instance.mountedDeps.delete(dep)) return
	const owners = new Set<EffectLifecycle<any>>()
	const visited = new Set<Instance<any>>()
	const collect = (consumer: Instance<any>) => {
		if (visited.has(consumer)) return
		visited.add(consumer)
		const lifecycle = consumer.effectLifecycle
		if (lifecycle && (lifecycle.cleanup || lifecycle.cleaning))
			owners.add(lifecycle)
		for (const deferred of consumer.deferredOwners)
			for (const owner of deferred.owners) owners.add(owner)
		for (const sub of consumer.mountedSubs) collect(sub)
	}
	collect(instance)
	dep.mountedSubs.delete(instance)
	if (owners.size === 0) release(state, dep)
	else {
		const deferred: DeferredRelease = { dependency: dep, owners }
		dep.deferredOwners.add(deferred)
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
			deferred.dependency.deferredOwners.delete(deferred)
			release(state, deferred.dependency)
		}
	}
	lifecycle.dependencies.clear()
	lifecycle.cleaning = false
}

export function peekInstance<S>(state: StoreState, instance: Instance<S>) {
	isoAssert(instance.freshness.type !== 'evaluating', 'cyclic atom dependency')
	const { symbol } = instance
	if (symbol.type === 'derived') revalidateUnmounted(state, instance)
	if (instance.freshness.type === 'dirty') {
		isoAssert(symbol.type === 'derived')
		instance.freshness = { type: 'evaluating' }
		instance.depVersions = new Map()
		const read = (<T, Key, Args extends unknown[]>(
			target: AtomFamily<T, Key, Args> | AtomSymbol<T, Args>,
			key?: Key,
		) => {
			const dep = getInstance(state, target, key)
			const value = peekInstance(state, dep)
			instance.depVersions.set(dep, dep.version)
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
	for (const [dep, version] of instance.depVersions) {
		if (dep.version !== version) return false
		peekInstance(state, dep)
		if (dep.version !== version) return false
	}
	return true
}
