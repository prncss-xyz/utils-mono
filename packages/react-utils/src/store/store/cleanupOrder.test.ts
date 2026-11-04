import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { getCleanupOrder, unownedComponent } from './cleanupOrder'
import type { EffectLifecycle, Instance } from './types'

type Node = Instance<any> & {
	effectLifecycle: EffectLifecycle<any> | undefined
}

type MutableLifecycle = {
	-readonly [K in keyof EffectLifecycle<any>]: EffectLifecycle<any>[K]
}

const node = (effect: boolean, mountCount = 1) => {
	const result = {
		mountCount,
		mountedSubs: new Set(),
		mountedDeps: new Set(),
		deferredOwners: new Set(),
		effectLifecycle: undefined,
	} as unknown as Node
	if (effect) {
		const lifecycle = {
			cleaning: false,
			dependencies: new Set(),
			readClosure: new Set(),
			deferredReleases: new Set(),
		} as unknown as MutableLifecycle
		lifecycle.instance = result
		result.effectLifecycle = lifecycle
	}
	return result
}

const link = (consumer: Node, dependency: Node) => {
	consumer.mountedDeps.add(dependency)
	dependency.mountedSubs.add(consumer)
}

const dag = fc
	.record({
		effects: fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
		edges: fc.array(fc.tuple(fc.nat({ max: 7 }), fc.nat({ max: 7 })), {
			maxLength: 14,
		}),
		requested: fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7]),
	})
	.map(({ effects, edges, requested }) => ({
		effects,
		edges: edges
			.map(([a, b]) => [a % effects.length, b % effects.length] as const)
			.filter(([consumer, dependency]) => consumer > dependency),
		requested: requested.filter((index) => index < effects.length),
	}))

/** Nearest effect-bearing dependencies, looking through nodes without effects. */
const nearest = (consumer: Node) => {
	const found = new Set<Node>()
	const visit = (current: Node) => {
		for (const dependency of current.mountedDeps as Set<Node>)
			if (dependency.effectLifecycle) found.add(dependency)
			else visit(dependency)
	}
	visit(consumer)
	return found
}

const withLifecycleDependencies = (nodes: Node[]) => {
	for (const item of nodes)
		if (item.effectLifecycle)
			for (const dependency of nearest(item))
				item.effectLifecycle.dependencies.add(dependency)
}

describe('getCleanupOrder', () => {
	it('lists every requested effect once, dependencies before consumers', () => {
		fc.assert(
			fc.property(dag, ({ effects, edges, requested: requestedIndices }) => {
				const nodes = effects.map((effect) => node(effect))
				for (const [consumer, dependency] of edges)
					link(nodes[consumer]!, nodes[dependency]!)
				withLifecycleDependencies(nodes)
				const requested = requestedIndices.map((index) => nodes[index]!)
				const order = getCleanupOrder(requested) as Node[]

				const withEffects = requested.filter((item) => item.effectLifecycle)
				expect(order).toHaveLength(withEffects.length)
				expect(new Set(order)).toEqual(new Set(withEffects))
				const before = (earlier: Node, later: Node) =>
					order.indexOf(earlier) < order.indexOf(later)
				const reaches = (from: Node, to: Node): boolean =>
					[...nearest(from)].some(
						(dependency) => dependency === to || reaches(dependency, to),
					)
				for (const consumer of order)
					for (const dependency of order)
						if (reaches(consumer, dependency))
							expect(before(dependency, consumer)).toBe(true)
			}),
			{ numRuns: 500 },
		)
	})

	it('puts a deferred dependency ahead of its owner unless the dependency records the owner as an effect dependency', () => {
		const owner = node(true)
		const resource = node(true)
		owner.effectLifecycle!.deferredReleases.add({
			dependency: resource,
			owners: new Set([owner.effectLifecycle!]),
		})
		expect(getCleanupOrder([owner, resource])).toEqual([resource, owner])

		link(resource, owner)
		withLifecycleDependencies([owner, resource])
		expect(getCleanupOrder([owner, resource])).toEqual([owner, resource])
	})

	it('lets a deferred dependency win over a mounted edge that points the other way', () => {
		const owner = node(true)
		const resource = node(true)
		owner.effectLifecycle!.deferredReleases.add({
			dependency: resource,
			owners: new Set([owner.effectLifecycle!]),
		})
		link(resource, owner)

		expect(getCleanupOrder([owner, resource])).toEqual([resource, owner])
	})

	it("looks through effect-less nodes to the deferred dependency's resource", () => {
		const owner = node(true)
		const bridge = node(false)
		const resource = node(true)
		link(bridge, resource)
		owner.effectLifecycle!.deferredReleases.add({
			dependency: bridge,
			owners: new Set([owner.effectLifecycle!]),
		})

		expect(getCleanupOrder([owner, resource])).toEqual([resource, owner])

		link(resource, owner)
		withLifecycleDependencies([owner, resource])
		expect(getCleanupOrder([owner, resource])).toEqual([owner, resource])
	})
})

describe('unownedComponent', () => {
	it('is the set of mounted consumers whose references all come from within it', () => {
		const dependency = node(false, 1)
		const consumer = node(false, 1)
		link(consumer, dependency)
		expect(unownedComponent(dependency)).toBeUndefined()

		consumer.mountCount = 0
		dependency.mountCount = 1
		expect(unownedComponent(dependency)).toEqual(
			new Set([dependency, consumer]),
		)

		dependency.mountCount = 2
		expect(unownedComponent(dependency)).toBeUndefined()
	})
})
