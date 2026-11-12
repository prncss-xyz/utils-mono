import fc from 'fast-check'
import { expect, it } from 'vitest'

import { derivedAtom, effectAtom, primitiveAtom, type AtomSymbol } from '.'
import {
	consumerCount,
	createStore,
	flushMicrotask,
	inspect,
	mountedDependencyCount,
	ownerCount,
	type Value,
} from './utils.testing'

const flags = { effect: fc.boolean(), mount: fc.boolean() }
const dependency = fc.integer({ min: 0, max: 13 })

const graph = fc
	.record({
		primitives: fc.array(
			fc.record({ initial: fc.integer({ min: 0, max: 3 }), ...flags }),
			{ minLength: 1, maxLength: 3, size: 'max' },
		),
		derived: fc.array(
			fc.record({
				a: dependency,
				b: dependency,
				c: dependency,
				modulus: fc.integer({ min: 2, max: 3 }),
				...flags,
			}),
			{ minLength: 1, maxLength: 11, size: 'max' },
		),
	})
	.map(({ primitives, derived }) => ({
		primitives,
		derived: derived.map((spec, index) => ({
			...spec,
			a: spec.a % (primitives.length + index),
			b: spec.b % (primitives.length + index),
			c: spec.c % (primitives.length + index),
		})),
	}))

const scenario = graph.chain((graph) => {
	const nodeCount = graph.primitives.length + graph.derived.length
	const primitive = fc.integer({ min: 0, max: graph.primitives.length - 1 })
	const node = fc.integer({ min: 0, max: nodeCount - 1 })
	return fc.record({
		graph: fc.constant(graph),
		operations: fc.array(
			fc.oneof(
				{
					weight: 6,
					arbitrary: fc.record({
						type: fc.constant('write' as const),
						primitive,
						value: fc.integer({ min: 0, max: 3 }),
					}),
				},
				{
					weight: 4,
					arbitrary: fc.record({
						type: fc.constant('subscribe' as const),
						node,
					}),
				},
				{
					weight: 3,
					arbitrary: fc.record({
						type: fc.constant('unsubscribe' as const),
						slot: fc.integer({ min: 0, max: 49 }),
					}),
				},
				{
					weight: 5,
					arbitrary: fc.record({ type: fc.constant('yield' as const) }),
				},
				{
					weight: 1,
					arbitrary: fc.record({ type: fc.constant('peek' as const), node }),
				},
			),
			{ maxLength: 50, size: 'max' },
		),
	})
})

type Graph = Value<typeof graph>

/**
 * Models value reachability, direct effect reads and owner-scoped children.
 * Effects retain their last direct read until cleanup; value intermediates
 * retain only their current dependencies. Every resource has a balanced lifetime
 * and is never released while a mounted consumer reaches it both before and
 * after the flush.
 */
async function run(
	graph: Graph,
	operations: Value<typeof scenario>['operations'],
) {
	const primitiveCount = graph.primitives.length
	const committed = graph.primitives.map(({ initial }) => initial)
	let prior = [...committed]
	const pending = new Map<number, number>()
	const subscriptions: { node: number; dispose: () => void }[] = []
	const log: string[] = []
	const steps: string[] = []
	const liveMounts = new Set<number>()
	const liveEffects = new Map<number, number>()
	const liveChildren = new Set<string>()
	const violations: string[] = []
	const spec = (node: number) =>
		node < primitiveCount
			? graph.primitives[node]!
			: graph.derived[node - primitiveCount]!
	const value = (node: number, values = committed): number => {
		if (node < primitiveCount) return values[node]!
		const { a, b, c, modulus } = graph.derived[node - primitiveCount]!
		return value(a, values) % modulus === 0
			? value(b, values)
			: value(c, values) % modulus
	}
	const direct = (node: number, values = committed): number[] => {
		if (node < primitiveCount) return []
		const { a, b, c, modulus } = graph.derived[node - primitiveCount]!
		return [a, value(a, values) % modulus === 0 ? b : c]
	}
	const closure = (roots: Iterable<number>, values = committed) => {
		const found = new Set<number>()
		const visit = (node: number) => {
			if (found.has(node)) return
			found.add(node)
			for (const dep of direct(node, values)) visit(dep)
		}
		for (const root of roots) visit(root)
		return found
	}
	const child = (key: string) =>
		effectAtom(() => {
			if (liveChildren.has(key)) violations.push(`${key} set up twice`)
			liveChildren.add(key)
			log.push(`child ${key}`)
			return () => {
				if (!liveChildren.delete(key)) violations.push(`${key} cleaned twice`)
				log.push(`child cleanup ${key}`)
			}
		})
	const options = (node: number) => ({
		onMount:
			spec(node).mount || spec(node).effect
				? (
						_read: unknown,
						_write: unknown,
						mountEffect: (effect: ReturnType<typeof effectAtom>) => void,
					) => {
						if (spec(node).mount) {
							if (liveMounts.has(node))
								violations.push(`n${node} mounted twice`)
							for (const dep of closure(direct(node)))
								if (spec(dep).mount && !liveMounts.has(dep))
									violations.push(`n${node} mounted before n${dep}`)
							liveMounts.add(node)
							log.push(`mount n${node}`)
						}
						if (spec(node).effect) mountEffect(child(`mount ${node}`))
						return () => {
							if (liveChildren.has(`mount ${node}`))
								violations.push(`child outlived mount n${node}`)
							if (!spec(node).mount) return
							if (!liveMounts.delete(node))
								violations.push(`n${node} unmounted twice`)
							if (liveEffects.has(node))
								violations.push(
									`n${node} unmounted while directly read by its effect`,
								)
							log.push(`unmount n${node}`)
							for (const consumer of liveMounts)
								if (
									closure(direct(consumer)).has(node) &&
									closure(direct(consumer, prior), prior).has(node)
								)
									violations.push(
										`n${node} released before mounted consumer n${consumer}`,
									)
						}
					}
				: undefined,
	})
	const nodes: AtomSymbol<number, any>[] = []
	for (const [index, { initial }] of graph.primitives.entries())
		nodes.push(primitiveAtom(initial, options(index)))
	for (const [index, { a, b, c, modulus }] of graph.derived.entries())
		nodes.push(
			derivedAtom(
				(read) =>
					read(nodes[a]!) % modulus === 0
						? read(nodes[b]!)
						: read(nodes[c]!) % modulus,
				undefined,
				options(primitiveCount + index),
			) as never,
		)
	const effects = nodes.map((symbol, node) =>
		effectAtom(
			(read) => read(symbol),
			(next, _last, _read, _write, mountEffect) => {
				if (liveEffects.has(node))
					violations.push(`effect n${node} ran without cleanup`)
				if (next !== value(node))
					violations.push(
						`effect n${node} read ${next}, expected ${value(node)}`,
					)
				if (spec(node).mount && !liveMounts.has(node))
					violations.push(`effect n${node} ran before its direct resource`)
				liveEffects.set(node, next)
				log.push(`effect n${node}=${next}`)
				mountEffect(child(`run ${node}`))
				return () => {
					if (!liveEffects.delete(node))
						violations.push(`effect n${node} cleaned twice`)
					log.push(`cleanup n${node}`)
				}
			},
		),
	)
	const store = createStore()
	const report = (label: string) =>
		`${label}\nsteps:\n${steps.join('\n')}\nlog:\n${log.join('\n')}`
	const commit = async () => {
		for (const [node, next] of pending) committed[node] = next
		pending.clear()
		await flushMicrotask()
		prior = [...committed]
	}
	const check = (settled: boolean, label: string) => {
		const reachable = closure(subscriptions.map(({ node }) => node))
		if (settled) {
			for (const node of nodes.keys()) {
				if (spec(node).mount && liveMounts.has(node) !== reachable.has(node))
					violations.push(`n${node} mount reachability mismatch`)
				const active =
					spec(node).effect &&
					subscriptions.some((subscription) => subscription.node === node)
				if (liveEffects.has(node) !== active)
					violations.push(`n${node} effect reachability mismatch`)
				if (active && liveEffects.get(node) !== value(node))
					violations.push(`n${node} stale effect`)
				if (
					spec(node).effect &&
					liveChildren.has(`mount ${node}`) !== reachable.has(node)
				)
					violations.push(`n${node} mount child mismatch`)
				if (liveChildren.has(`run ${node}`) !== active)
					violations.push(`n${node} run child mismatch`)
			}
		}
		expect(violations, report(label)).toEqual([])
	}
	for (const [index, operation] of operations.entries()) {
		const label = `step ${index} ${JSON.stringify(operation)}`
		steps.push(label)
		switch (operation.type) {
			case 'write':
				store.send(nodes[operation.primitive]!, operation.value)
				pending.set(operation.primitive, operation.value)
				break
			case 'subscribe':
				subscriptions.push({
					node: operation.node,
					dispose: spec(operation.node).effect
						? store.mountEffect(effects[operation.node]!)
						: store.subscribe(nodes[operation.node]!, () => {}),
				})
				break
			case 'unsubscribe':
				if (subscriptions.length > 0)
					subscriptions
						.splice(operation.slot % subscriptions.length, 1)[0]!
						.dispose()
				break
			case 'peek': {
				const before = log.length
				expect(store.peek(nodes[operation.node]!), report(label)).toBe(
					value(operation.node),
				)
				expect(log.length, report('peek ran lifecycle callbacks')).toBe(before)
				break
			}
			case 'yield':
				await commit()
				break
		}
		check(operation.type === 'yield', label)
	}
	for (const { dispose } of subscriptions.splice(0)) dispose()
	expect(
		[...liveMounts, ...liveEffects.keys(), ...liveChildren],
		report('last release'),
	).toEqual([])
	await commit()
	check(true, 'final release')
	for (const symbol of [...nodes, ...effects]) {
		const instance = inspect(store).instances.get(symbol)
		if (instance)
			expect(
				[
					instance.mountCount,
					consumerCount(instance),
					mountedDependencyCount(instance),
					ownerCount(instance),
				],
				report('remaining references'),
			).toEqual([0, 0, 0, 0])
	}
}

/**
 * Shrunk case: n3 is mounted without `onMount` and gains n2 when P0 flips,
 * while the newly subscribed n5 reads n3; n2 must mount before n5.
 */
const mountOrderExample: Value<typeof scenario> = {
	graph: {
		primitives: [{ initial: 0, effect: true, mount: false }],
		derived: [
			{ a: 0, b: 0, c: 0, modulus: 3, effect: false, mount: false },
			{ a: 1, b: 0, c: 1, modulus: 3, effect: false, mount: true },
			{ a: 0, b: 2, c: 1, modulus: 2, effect: true, mount: false },
			{ a: 3, b: 1, c: 0, modulus: 3, effect: true, mount: false },
			{ a: 1, b: 4, c: 1, modulus: 2, effect: false, mount: true },
			{ a: 2, b: 1, c: 1, modulus: 3, effect: false, mount: false },
			{ a: 1, b: 0, c: 5, modulus: 3, effect: true, mount: true },
		],
	},
	operations: [
		{ type: 'subscribe', node: 3 },
		{ type: 'write', primitive: 0, value: 3 },
		{ type: 'yield' },
		{ type: 'subscribe', node: 5 },
		{ type: 'write', primitive: 0, value: 0 },
		{ type: 'yield' },
	],
}

/**
 * Stored release-order graph: P1 relinks n3 and n5 away from n2. Leaf
 * observers hold their direct value nodes, while n2 follows current value reachability.
 */
const disposeOrderExample: Value<typeof scenario> = {
	graph: {
		primitives: [
			{ initial: 1, effect: false, mount: false },
			{ initial: 1, effect: false, mount: false },
		],
		derived: [
			{ a: 1, b: 0, c: 0, modulus: 3, effect: true, mount: true },
			{ a: 1, b: 1, c: 2, modulus: 3, effect: true, mount: false },
			{ a: 2, b: 1, c: 3, modulus: 2, effect: true, mount: true },
			{ a: 0, b: 3, c: 0, modulus: 3, effect: true, mount: false },
			{ a: 1, b: 1, c: 2, modulus: 2, effect: false, mount: false },
			{ a: 6, b: 1, c: 0, modulus: 2, effect: true, mount: false },
			{ a: 5, b: 6, c: 0, modulus: 3, effect: true, mount: true },
		],
	},
	operations: [
		{ type: 'write', primitive: 1, value: 0 },
		{ type: 'subscribe', node: 8 },
		{ type: 'write', primitive: 0, value: 0 },
		{ type: 'yield' },
		{ type: 'write', primitive: 1, value: 1 },
		{ type: 'yield' },
		{ type: 'write', primitive: 0, value: 1 },
		{ type: 'yield' },
	],
}

/**
 * Shrunk case: n2 stays mounted without a consumer after P1 is rewritten.
 */
const danglingMountExample: Value<typeof scenario> = {
	graph: {
		primitives: [
			{ initial: 3, effect: false, mount: true },
			{ initial: 2, effect: false, mount: false },
		],
		derived: [
			{ a: 1, b: 0, c: 0, modulus: 3, effect: false, mount: true },
			{ a: 1, b: 2, c: 0, modulus: 3, effect: false, mount: true },
			{ a: 1, b: 0, c: 0, modulus: 2, effect: false, mount: false },
			{ a: 4, b: 0, c: 1, modulus: 3, effect: true, mount: true },
			{ a: 1, b: 1, c: 3, modulus: 3, effect: false, mount: true },
			{ a: 5, b: 6, c: 4, modulus: 3, effect: true, mount: true },
			{ a: 5, b: 1, c: 6, modulus: 3, effect: false, mount: false },
		],
	},
	operations: [
		{ type: 'subscribe', node: 7 },
		{ type: 'yield' },
		{ type: 'write', primitive: 1, value: 0 },
		{ type: 'yield' },
		{ type: 'write', primitive: 1, value: 2 },
		{ type: 'yield' },
	],
}

/**
 * Shrunk case: n2 is unmounted while n6 still reads it after P0 and P1 are
 * written in one flush.
 */
const unmountOrderExample: Value<typeof scenario> = {
	graph: {
		primitives: [
			{ initial: 0, effect: true, mount: true },
			{ initial: 3, effect: false, mount: false },
			{ initial: 1, effect: false, mount: true },
		],
		derived: [
			{ a: 0, b: 2, c: 1, modulus: 3, effect: false, mount: true },
			{ a: 0, b: 0, c: 2, modulus: 3, effect: false, mount: true },
			{ a: 3, b: 4, c: 1, modulus: 2, effect: false, mount: true },
			{ a: 1, b: 3, c: 4, modulus: 3, effect: false, mount: true },
			{ a: 3, b: 2, c: 2, modulus: 2, effect: false, mount: false },
			{ a: 1, b: 5, c: 6, modulus: 2, effect: false, mount: true },
			{ a: 0, b: 6, c: 5, modulus: 3, effect: false, mount: false },
		],
	},
	operations: [
		{ type: 'subscribe', node: 8 },
		{ type: 'yield' },
		{ type: 'write', primitive: 0, value: 1 },
		{ type: 'write', primitive: 1, value: 2 },
		{ type: 'yield' },
	],
}

/**
 * Stored late-linked-owner graph: n2 must lose its last reference when the
 * current value graph no longer reaches it, even while a leaf observer stays live.
 */
const lateLinkedOwnerExample: Value<typeof scenario> = {
	graph: {
		primitives: [
			{ initial: 0, effect: false, mount: false },
			{ initial: 1, effect: false, mount: false },
		],
		derived: [
			{ a: 0, b: 0, c: 1, modulus: 3, effect: false, mount: false },
			{ a: 1, b: 0, c: 2, modulus: 2, effect: false, mount: false },
			{ a: 3, b: 1, c: 1, modulus: 2, effect: false, mount: false },
			{ a: 1, b: 3, c: 0, modulus: 2, effect: true, mount: false },
		],
	},
	operations: [
		{ type: 'write', primitive: 1, value: 0 },
		{ type: 'subscribe', node: 3 },
		{ type: 'subscribe', node: 5 },
		{ type: 'subscribe', node: 4 },
		{ type: 'yield' },
		{ type: 'write', primitive: 1, value: 1 },
		{ type: 'yield' },
		{ type: 'write', primitive: 1, value: 0 },
		{ type: 'yield' },
	],
}

/**
 * Stored late-linked-reader graph: n4 links n3 while its leaf observer does
 * not rerun. Resources below n3 follow the current value graph, without an
 * observer accumulating transitive ownership.
 */
const lateLinkedReaderExample: Value<typeof scenario> = {
	graph: {
		primitives: [
			{ initial: 1, effect: false, mount: true },
			{ initial: 0, effect: false, mount: false },
			{ initial: 3, effect: false, mount: true },
		],
		derived: [
			{ a: 1, b: 2, c: 0, modulus: 3, effect: false, mount: true },
			{ a: 1, b: 2, c: 3, modulus: 3, effect: true, mount: true },
			{ a: 2, b: 4, c: 4, modulus: 2, effect: false, mount: false },
			{ a: 0, b: 1, c: 4, modulus: 3, effect: false, mount: false },
		],
	},
	operations: [
		{ type: 'write', primitive: 2, value: 1 },
		{ type: 'subscribe', node: 4 },
		{ type: 'yield' },
		{ type: 'write', primitive: 1, value: 1 },
		{ type: 'yield' },
		{ type: 'write', primitive: 1, value: 0 },
		{ type: 'yield' },
	],
}

it('keeps effect and mount lifecycles balanced and ordered across random graphs', async () => {
	await fc.assert(
		fc.asyncProperty(scenario, ({ graph, operations }) =>
			run(graph, operations),
		),
		{
			numRuns: 1000,
			examples: [
				[mountOrderExample],
				[disposeOrderExample],
				[danglingMountExample],
				[unmountOrderExample],
				[lateLinkedOwnerExample],
				[lateLinkedReaderExample],
			],
		},
	)
}, 15_000)
