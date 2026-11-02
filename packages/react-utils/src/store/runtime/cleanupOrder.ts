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
	const deferredDependencies: [EffectLifecycle<any>, EffectLifecycle<any>][] =
		[]
	const collect = (lifecycle: EffectLifecycle<any>) => {
		if (dependencies.has(lifecycle)) return
		const deps = new Set<EffectLifecycle<any>>()
		dependencies.set(lifecycle, deps)
		const collectDependency = (
			dependency: Instance<any>,
			deferred: boolean,
			visited = new Set<Instance<any>>(),
		): void => {
			if (visited.has(dependency)) return
			visited.add(dependency)
			const dependencyLifecycle = dependency.effectLifecycle
			if (dependencyLifecycle) {
				if (deferred)
					deferredDependencies.push([lifecycle, dependencyLifecycle])
				else deps.add(dependencyLifecycle)
				collect(dependencyLifecycle)
			} else
				for (const dep of dependency.mountedDeps)
					collectDependency(dep, deferred, visited)
		}
		for (const dependency of lifecycle.dependencies)
			collectDependency(dependency, false)
		for (const { dependency } of lifecycle.deferredReleases)
			collectDependency(dependency, true)
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
	for (const [lifecycle, dependency] of deferredDependencies)
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
			current.mountedSubs.size + current.deferredOwners.size
		)
			return false
		for (const consumer of current.mountedSubs)
			if (!collect(consumer)) return false
		for (const deferred of current.deferredOwners)
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
