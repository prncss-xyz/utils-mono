import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { primitiveAtom } from '../atoms'
import {
	addMountedEdge,
	clearDependencies,
	consumerCount,
	consumers,
	dependencies,
	dependencyCount,
	dependencyVersions,
	detachMountedEdges,
	hasDependency,
	hasMountedDependency,
	mountedDependencies,
	mountedDependencyCount,
	recordDependency,
	removeMountedEdge,
	resetDependencies,
} from './graph'
import { getInstance } from './registry'
import { createStubState } from './utils.testing'

type Node = ReturnType<typeof instances>[number]

const COUNT = 5
const index = fc.nat({ max: COUNT - 1 })
const operation = fc.oneof(
	fc.record({ type: fc.constant('add' as const), from: index, to: index }),
	fc.record({ type: fc.constant('remove' as const), from: index, to: index }),
	fc.record({ type: fc.constant('detach' as const), from: index }),
)

const instances = () => {
	const state = createStubState()
	return Array.from({ length: COUNT }, () =>
		getInstance(state, primitiveAtom(0)),
	)
}

describe('mounted edges', () => {
	it('keeps both directions of every edge in step with a set of pairs', () => {
		fc.assert(
			fc.property(fc.array(operation, { maxLength: 40 }), (operations) => {
				const nodes = instances()
				const edges = new Set<string>()
				const key = (from: number, to: number) => `${from}>${to}`
				for (const step of operations) {
					if (step.type === 'add' && step.from !== step.to) {
						if (!edges.has(key(step.from, step.to)))
							addMountedEdge(nodes[step.from]!, nodes[step.to]!)
						edges.add(key(step.from, step.to))
					} else if (step.type === 'remove') {
						removeMountedEdge(nodes[step.from]!, nodes[step.to]!)
						edges.delete(key(step.from, step.to))
					} else if (step.type === 'detach') {
						const detached = new Set(detachMountedEdges(nodes[step.from]!))
						const expected = nodes.filter((_, to) =>
							edges.has(key(step.from, to)),
						)
						expect(detached).toEqual(new Set(expected))
						for (const to of nodes.keys()) edges.delete(key(step.from, to))
					}
					for (const [from, node] of nodes.entries()) {
						const deps = nodes.filter((_, to) => edges.has(key(from, to)))
						const subs = nodes.filter((_, other) => edges.has(key(other, from)))
						expect(new Set(mountedDependencies(node))).toEqual(new Set(deps))
						expect(mountedDependencyCount(node)).toBe(deps.length)
						expect(new Set(consumers(node))).toEqual(new Set(subs))
						expect(consumerCount(node)).toBe(subs.length)
						for (const dep of nodes)
							expect(hasMountedDependency(node, dep)).toBe(deps.includes(dep))
					}
				}
			}),
			{ numRuns: 300 },
		)
	})
})

describe('dependency records', () => {
	it('records read versions, which are empty after reset and after clear', () => {
		const [consumer, first, second] = instances() as [Node, Node, Node]

		recordDependency(consumer, first, 1)
		recordDependency(consumer, second, 4)
		recordDependency(consumer, first, 2)
		expect([...dependencyVersions(consumer)]).toEqual([
			[first, 2],
			[second, 4],
		])
		expect([...dependencies(consumer)]).toEqual([first, second])
		expect(dependencyCount(consumer)).toBe(2)
		expect(hasDependency(consumer, second)).toBe(true)

		resetDependencies(consumer)
		expect(dependencyCount(consumer)).toBe(0)
		expect([...dependencies(consumer)]).toEqual([])
		expect(hasDependency(consumer, first)).toBe(false)
		expect(hasDependency(consumer, second)).toBe(false)

		recordDependency(consumer, first, 3)
		clearDependencies(consumer)
		expect(hasDependency(consumer, first)).toBe(false)
	})
})
