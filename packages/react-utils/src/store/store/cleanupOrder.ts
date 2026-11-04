import {
	mountedDependencies,
	consumers,
	consumerCount,
	deferredOwners,
	deferredOwnerCount,
} from './graph'
import type { EffectLifecycle, Instance } from './types'

export function getCleanupOrder(instances: Iterable<Instance<any>>) {
	const cleanupInstances = new Map<EffectLifecycle<any>, Instance<any>>()
	for (const instance of instances)
		if (instance.effectLifecycle)
			cleanupInstances.set(instance.effectLifecycle, instance)
	const dependencies = new Map<
		EffectLifecycle<any>,
		Set<EffectLifecycle<any>>
	>()
	type Edge = [EffectLifecycle<any>, EffectLifecycle<any>]
	const deferredDependencies: Edge[] = []
	const mountedDependencyEdges: Edge[] = []
	const collect = (lifecycle: EffectLifecycle<any>) => {
		if (dependencies.has(lifecycle)) return
		const deps = new Set<EffectLifecycle<any>>()
		dependencies.set(lifecycle, deps)
		const collectDependency = (
			dependency: Instance<any>,
			target: Set<EffectLifecycle<any>> | Edge[],
			visited = new Set<Instance<any>>(),
		): void => {
			if (visited.has(dependency)) return
			visited.add(dependency)
			const dependencyLifecycle = dependency.effectLifecycle
			if (dependencyLifecycle) {
				if (Array.isArray(target)) target.push([lifecycle, dependencyLifecycle])
				else target.add(dependencyLifecycle)
				collect(dependencyLifecycle)
			} else
				for (const dep of mountedDependencies(dependency))
					collectDependency(dep, target, visited)
		}
		for (const dependency of lifecycle.dependencies)
			collectDependency(dependency, deps)
		for (const dependency of mountedDependencies(lifecycle.instance))
			collectDependency(dependency, mountedDependencyEdges)
		for (const { dependency } of lifecycle.deferredReleases)
			collectDependency(dependency, deferredDependencies)
	}
	for (const lifecycle of cleanupInstances.keys()) collect(lifecycle)
	const reaches = (
		from: EffectLifecycle<any>,
		to: EffectLifecycle<any>,
		visited = new Set<EffectLifecycle<any>>(),
	): boolean => {
		if (from === to) return true
		if (visited.has(from)) return false
		visited.add(from)
		for (const dependency of dependencies.get(from)!)
			if (reaches(dependency, to, visited)) return true
		return false
	}
	for (const [lifecycle, dependency] of [
		...deferredDependencies,
		...mountedDependencyEdges,
	])
		if (!reaches(dependency, lifecycle))
			dependencies.get(lifecycle)!.add(dependency)
	const cleanupOrder: Instance<any>[] = []
	const visited = new Set<EffectLifecycle<any>>()
	const order = (lifecycle: EffectLifecycle<any>) => {
		if (visited.has(lifecycle)) return
		visited.add(lifecycle)
		for (const dependency of dependencies.get(lifecycle)!) order(dependency)
		const instance = cleanupInstances.get(lifecycle)
		if (instance) cleanupOrder.push(instance)
	}
	for (const lifecycle of cleanupInstances.keys()) order(lifecycle)
	return cleanupOrder
}
export function unownedComponent(instance: Instance<any>) {
	const component = new Set<Instance<any>>()
	const collect = (current: Instance<any>): boolean => {
		if (component.has(current)) return true
		component.add(current)
		if (
			current.mountCount >
			consumerCount(current) + deferredOwnerCount(current)
		)
			return false
		for (const consumer of consumers(current))
			if (!collect(consumer)) return false
		for (const deferred of deferredOwners(current))
			for (const owner of deferred.owners)
				if (
					owner.cleaning ||
					owner.instance.effectLifecycle !== owner ||
					!collect(owner.instance)
				)
					return false
		return true
	}
	return collect(instance) ? component : undefined
}
