import { isoAssert } from '../../functions'
import type { Instance } from './types'

const noDependencies: ReadonlyMap<Instance<any>, number> = new Map()
const noEdges: ReadonlySet<Instance<any>> = new Set()
const noOwners: ReadonlyMap<Instance<any>, number> = new Map()

/**
 * Link collections start absent and are allocated on first insertion, since
 * primitives never record dependencies, only effect atoms have owners, and
 * unmounted instances have no mounted edges. An absent collection reads as an
 * empty one of the same kind, which keeps iteration sites monomorphic.
 */
export function createLinks() {
	return {
		depVersions: undefined,
		mountedSubs: undefined,
		mountedDeps: undefined,
		owners: undefined,
	}
}

export function dependencies(instance: Instance<any>): Iterable<Instance<any>> {
	return (instance.depVersions ?? noDependencies).keys()
}

export function dependencyVersions(
	instance: Instance<any>,
): Iterable<[Instance<any>, number]> {
	return instance.depVersions ?? noDependencies
}

export function hasDependency(instance: Instance<any>, dep: Instance<any>) {
	return (instance.depVersions ?? noDependencies).has(dep)
}

export function dependencyCount(instance: Instance<any>) {
	return (instance.depVersions ?? noDependencies).size
}

export function consumers(instance: Instance<any>): Iterable<Instance<any>> {
	return instance.mountedSubs ?? noEdges
}

export function consumerCount(instance: Instance<any>) {
	return (instance.mountedSubs ?? noEdges).size
}

export function mountedDependencies(
	instance: Instance<any>,
): Iterable<Instance<any>> {
	return instance.mountedDeps ?? noEdges
}

export function hasMountedDependency(
	instance: Instance<any>,
	dep: Instance<any>,
) {
	return (instance.mountedDeps ?? noEdges).has(dep)
}

export function mountedDependencyCount(instance: Instance<any>) {
	return (instance.mountedDeps ?? noEdges).size
}

/**
 * Drops the dependency record instead of clearing it, so an iteration of the
 * previous record still in progress is left intact.
 */
export function resetDependencies(instance: Instance<any>) {
	instance.depVersions = undefined
}

export function recordDependency(
	instance: Instance<any>,
	dep: Instance<any>,
	version: number,
) {
	;(instance.depVersions ??= new Map()).set(dep, version)
}

export function addMountedEdge(instance: Instance<any>, dep: Instance<any>) {
	isoAssert(!hasMountedDependency(instance, dep), 'mounted edge added twice')
	;(instance.mountedDeps ??= new Set()).add(dep)
	;(dep.mountedSubs ??= new Set()).add(instance)
}

export function removeMountedEdge(instance: Instance<any>, dep: Instance<any>) {
	isoAssert(hasMountedDependency(instance, dep), 'mounted edge missing')
	instance.mountedDeps!.delete(dep)
	dep.mountedSubs!.delete(instance)
}

/**
 * Swaps out the mounted dependency set and clears the reverse links. It
 * must run before any user callback can change dependencies or remount.
 */
export function detachMountedEdges(
	instance: Instance<any>,
): Iterable<Instance<any>> {
	const mountedDeps = instance.mountedDeps ?? noEdges
	instance.mountedDeps = undefined
	for (const dep of mountedDeps) {
		isoAssert(dep.mountedSubs)
		dep.mountedSubs.delete(instance)
	}
	return mountedDeps
}

export function owners(instance: Instance<any>): Iterable<Instance<any>> {
	return (instance.owners ?? noOwners).keys()
}

/** The owners of the effect instance with their reference counts. */
export function ownerReferences(
	instance: Instance<any>,
): Iterable<[Instance<any>, number]> {
	return instance.owners ?? noOwners
}

/** Adds one ownership reference from `owner` to the effect instance `child`. */
export function addOwner(child: Instance<any>, owner: Instance<any>) {
	const counts = (child.owners ??= new Map())
	counts.set(owner, (counts.get(owner) ?? 0) + 1)
}

/** Drops one ownership reference, removing `owner` with its last one. */
export function releaseOwner(child: Instance<any>, owner: Instance<any>) {
	const counts = child.owners
	isoAssert(counts)
	const references = counts.get(owner)!
	// Stryker disable next-line ConditionalExpression: releaseChildren releases every reference of an owner in one loop, and no reader of owner references can run before it ends
	if (references === 1) counts.delete(owner)
	else counts.set(owner, references - 1)
}
