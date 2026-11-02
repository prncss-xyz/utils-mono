import type { DeferredRelease, Instance } from './types'

export function createLinks() {
	return {
		depVersions: new Map<Instance<any>, number>(),
		mountedSubs: new Set<Instance<any>>(),
		mountedDeps: new Set<Instance<any>>(),
		deferredOwners: new Set<DeferredRelease>(),
	}
}

export function dependencies(instance: Instance<any>): Iterable<Instance<any>> {
	return instance.depVersions.keys()
}

export function dependencyVersions(
	instance: Instance<any>,
): Iterable<[Instance<any>, number]> {
	return instance.depVersions
}

export function hasDependency(instance: Instance<any>, dep: Instance<any>) {
	return instance.depVersions.has(dep)
}

export function dependencyCount(instance: Instance<any>) {
	return instance.depVersions.size
}

export function consumers(instance: Instance<any>): Iterable<Instance<any>> {
	return instance.mountedSubs
}

export function consumerCount(instance: Instance<any>) {
	return instance.mountedSubs.size
}

export function mountedDependencies(
	instance: Instance<any>,
): Iterable<Instance<any>> {
	return instance.mountedDeps
}

export function hasMountedDependency(
	instance: Instance<any>,
	dep: Instance<any>,
) {
	return instance.mountedDeps.has(dep)
}

export function mountedDependencyCount(instance: Instance<any>) {
	return instance.mountedDeps.size
}

export function deferredOwners(
	instance: Instance<any>,
): Iterable<DeferredRelease> {
	return instance.deferredOwners
}

export function deferredOwnerCount(instance: Instance<any>) {
	return instance.deferredOwners.size
}

export function clearDependencies(instance: Instance<any>) {
	instance.depVersions.clear()
}

export function resetDependencies(instance: Instance<any>) {
	instance.depVersions = new Map()
}

export function recordDependency(
	instance: Instance<any>,
	dep: Instance<any>,
	version: number,
) {
	instance.depVersions.set(dep, version)
}

export function addMountedEdge(instance: Instance<any>, dep: Instance<any>) {
	instance.mountedDeps.add(dep)
	dep.mountedSubs.add(instance)
}

export function removeMountedEdge(instance: Instance<any>, dep: Instance<any>) {
	instance.mountedDeps.delete(dep)
	dep.mountedSubs.delete(instance)
}

/**
 * Swaps out the mounted dependency set and clears the reverse links. It
 * must run before any user callback can change dependencies or remount.
 */
export function detachMountedEdges(
	instance: Instance<any>,
): Iterable<Instance<any>> {
	const mountedDeps = instance.mountedDeps
	instance.mountedDeps = new Set()
	for (const dep of mountedDeps) dep.mountedSubs.delete(instance)
	return mountedDeps
}

export function addDeferredOwner(
	instance: Instance<any>,
	deferred: DeferredRelease,
) {
	instance.deferredOwners.add(deferred)
}

export function removeDeferredOwner(
	instance: Instance<any>,
	deferred: DeferredRelease,
) {
	instance.deferredOwners.delete(deferred)
}
