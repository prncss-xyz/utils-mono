import fc from 'fast-check'
import { expect, it } from 'vitest'

import { derivedAtom, primitiveAtom, type AtomSymbol } from '.'
import {
	consumerCount,
	createStore,
	deferredOwnerCount,
	flushMicrotask,
	inspect,
	mountedDependencyCount,
	type Value,
} from './utils.testing'

const flags = { effect: fc.boolean(), mount: fc.boolean() }
const dependency = fc.integer({ min: 0, max: 9 })

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
			{ minLength: 1, maxLength: 7, size: 'max' },
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
						slot: fc.integer({ min: 0, max: 29 }),
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
			{ maxLength: 30, size: 'max' },
		),
	})
})

type Graph = Value<typeof graph>

/**
 * Runs the graph against the lifecycle contract: every setup has one cleanup,
 * dependencies are set up before and cleaned after their consumers, and no
 * resource is released while a mounted consumer still reads it.
 */
async function run(
	graph: Graph,
	operations: Value<typeof scenario>['operations'],
) {
	const primitiveCount = graph.primitives.length
	const committed = graph.primitives.map(({ initial }) => initial)
	let prior = [...committed]
	const pending = new Map<number, number>()
	const subscriptions: { node: number; release: () => void }[] = []
	const steps: string[] = []
	const log: string[] = []
	const violations: string[] = []
	const liveEffects = new Map<number, { value: number; closure: Set<number> }>()
	const liveMounts = new Set<number>()
	const lastSetup = new Map<number, number>()
	const history: {
		kind: 'setup' | 'cleanup' | 'mount' | 'unmount'
		node: number
	}[] = []
	const suspects: {
		index: number
		node: number
		consumer: number
		kind: 'cleanup' | 'unmount'
		consumerReleaseKind: 'cleanup' | 'unmount'
	}[] = []

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
	const directDependencies = (node: number, values = committed): number[] => {
		if (node < primitiveCount) return []
		const { a, b, c, modulus } = graph.derived[node - primitiveCount]!
		return [a, value(a, values) % modulus === 0 ? b : c]
	}
	const closure = (nodes: Iterable<number>, values = committed) => {
		const result = new Set<number>()
		const visit = (node: number) => {
			for (const dependency of directDependencies(node, values))
				if (!result.has(dependency)) {
					result.add(dependency)
					visit(dependency)
				}
		}
		for (const node of nodes) visit(node)
		return result
	}
	const nearest = (node: number, flag: keyof typeof flags) => {
		const result = new Set<number>()
		const visit = (current: number) => {
			for (const dependency of directDependencies(current))
				if (spec(dependency)[flag]) result.add(dependency)
				else visit(dependency)
		}
		visit(node)
		return result
	}
	const violate = (message: string) => violations.push(message)

	const onSetup = (node: number, next: number, last: number | undefined) => {
		log.push(`setup n${node}=${next}`)
		history.push({ kind: 'setup', node })
		if (liveEffects.has(node)) violate(`n${node} set up twice without cleanup`)
		if (next !== value(node))
			violate(`n${node} set up with ${next}, current value is ${value(node)}`)
		if (Object.is(next, last))
			violate(`n${node} rerun although its value stayed ${next}`)
		if (last !== undefined && last !== lastSetup.get(node))
			violate(`n${node} saw previous ${last}, expected ${lastSetup.get(node)}`)
		for (const dependency of nearest(node, 'effect'))
			if (!liveEffects.has(dependency))
				violate(`n${node} set up before its dependency n${dependency}`)
		liveEffects.set(node, { value: next, closure: closure([node]) })
		lastSetup.set(node, next)
	}
	const suspectConsumers = (node: number, kind: 'cleanup' | 'unmount') => {
		for (const [consumer, { closure: reads }] of liveEffects)
			if (consumer !== node && reads.has(node))
				suspects.push({
					index: history.length,
					node,
					consumer,
					kind,
					consumerReleaseKind: 'cleanup',
				})
	}
	const onCleanup = (node: number) => {
		log.push(`cleanup n${node}`)
		history.push({ kind: 'cleanup', node })
		if (!liveEffects.has(node)) violate(`n${node} cleaned up while not set up`)
		suspectConsumers(node, 'cleanup')
		liveEffects.delete(node)
	}
	/**
	 * Every nearest dependency with `onMount`, reached through intermediates
	 * without one, must mount first, including a dependency newly linked
	 * beneath an already-mounted intermediate in the same flush.
	 */
	const onMount = (node: number) => {
		log.push(`mount n${node}`)
		history.push({ kind: 'mount', node })
		if (liveMounts.has(node)) violate(`n${node} mounted twice`)
		for (const dependency of nearest(node, 'mount'))
			if (!liveMounts.has(dependency))
				violate(`n${node} mounted before its dependency n${dependency}`)
		liveMounts.add(node)
	}
	const onUnmount = (node: number) => {
		log.push(`unmount n${node}`)
		history.push({ kind: 'unmount', node })
		if (!liveMounts.has(node)) violate(`n${node} unmounted while not mounted`)
		liveMounts.delete(node)
		for (const consumer of liveMounts)
			if (closure([consumer]).has(node) && closure([consumer], prior).has(node))
				suspects.push({
					index: history.length,
					node,
					consumer,
					kind: 'unmount',
					consumerReleaseKind: 'unmount',
				})
		suspectConsumers(node, 'unmount')
	}

	const options = (node: number) => {
		const { effect, mount } = spec(node)
		return {
			effect: effect
				? (next: number, last: number | undefined) => {
						onSetup(node, next, last)
						return () => onCleanup(node)
					}
				: undefined,
			onMount: mount
				? () => {
						onMount(node)
						return () => onUnmount(node)
					}
				: undefined,
		}
	}
	const nodes: AtomSymbol<number, any>[] = []
	for (const [index, { initial }] of graph.primitives.entries())
		nodes.push(primitiveAtom(initial, options(index)) as never)
	for (const [index, { a, b, c, modulus }] of graph.derived.entries())
		nodes.push(
			derivedAtom<number>(
				(get) =>
					get(nodes[a]!) % modulus === 0
						? get(nodes[b]!)
						: get(nodes[c]!) % modulus,
				undefined,
				options(primitiveCount + index),
			) as never,
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

	const mounted = () => {
		const roots = subscriptions.map(({ node }) => node)
		return new Set([...roots, ...closure(roots)])
	}
	const check = (settled: boolean, step: string) => {
		for (const {
			index,
			node,
			consumer,
			kind,
			consumerReleaseKind,
		} of suspects.splice(0)) {
			const later = history.slice(index)
			const reacquired = later.some(
				(event) =>
					event.node === node &&
					event.kind === (kind === 'cleanup' ? 'setup' : 'mount'),
			)
			const consumerCleaned = later.some(
				(event) =>
					event.node === consumer && event.kind === consumerReleaseKind,
			)
			if (!reacquired || consumerCleaned)
				violate(
					`n${node} ${kind === 'cleanup' ? 'cleaned up' : 'unmounted'} while n${consumer} still reads it without being released first`,
				)
		}
		for (const [node, effect] of liveEffects)
			for (const read of [...closure([node]), ...closure([node], prior)])
				effect.closure.add(read)
		const reachable = mounted()
		const allowed = new Set([...reachable])
		for (const { closure: reads } of liveEffects.values())
			for (const node of reads) allowed.add(node)
		for (const node of closure(allowed)) allowed.add(node)
		for (const node of liveMounts)
			if (!allowed.has(node)) violate(`n${node} mounted without a consumer`)
		for (const [node, { value: setup }] of liveEffects) {
			if (!allowed.has(node)) violate(`n${node} set up without a consumer`)
			if (settled && setup !== value(node))
				violate(
					`n${node} effect holds ${setup}, current value is ${value(node)}`,
				)
		}
		if (settled)
			for (const node of reachable) {
				if (spec(node).mount && !liveMounts.has(node))
					violate(`n${node} is reachable but not mounted`)
				if (spec(node).effect && !liveEffects.has(node))
					violate(`n${node} is reachable but has no effect`)
			}
		for (const [node, symbol] of nodes.entries()) {
			const instance = inspect(store).instances.get(symbol)
			if (!instance) continue
			if (instance.mountCount > 0 && !allowed.has(node))
				violate(`n${node} holds ${instance.mountCount} references`)
			if (settled && reachable.has(node) && instance.mountCount === 0)
				violate(`n${node} is reachable but holds no reference`)
		}
		expect(violations, report(`after ${step}`)).toEqual([])
	}

	for (const [index, operation] of operations.entries()) {
		const step = `step ${index} ${JSON.stringify(operation)}`
		steps.push(step)
		switch (operation.type) {
			case 'write':
				store.send(
					nodes[operation.primitive]! as never,
					operation.value as never,
				)
				pending.set(operation.primitive, operation.value)
				check(false, step)
				break
			case 'subscribe':
				subscriptions.push({
					node: operation.node,
					release: store.subscribe(nodes[operation.node]!, () => {}),
				})
				check(false, step)
				break
			case 'unsubscribe': {
				if (subscriptions.length === 0) break
				subscriptions
					.splice(operation.slot % subscriptions.length, 1)[0]!
					.release()
				check(false, step)
				break
			}
			case 'peek': {
				const before = log.length
				expect(
					store.peek(nodes[operation.node]!),
					report(`${step}: peeked value`),
				).toBe(value(operation.node))
				expect(
					log.length,
					report(`${step}: peek ran lifecycle callbacks`),
				).toBe(before)
				break
			}
			case 'yield':
				await commit()
				check(true, step)
				break
		}
	}
	for (const { release } of subscriptions.splice(0)) release()
	expect(
		[...liveEffects.keys(), ...liveMounts],
		report('resources outlived their last subscription'),
	).toEqual([])
	await commit()
	check(true, 'final release')
	for (const [node, symbol] of nodes.entries()) {
		const instance = inspect(store).instances.get(symbol)
		if (!instance) continue
		expect(
			[
				instance.mountCount,
				consumerCount(instance),
				mountedDependencyCount(instance),
				deferredOwnerCount(instance),
			],
			report(`n${node} counts after release`),
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
 * Shrunk case: n2 is released while consumers n3 and n5 still read it, because
 * its cleanup runs before theirs after P1 flips.
 */
const releaseOrderExample: Value<typeof scenario> = {
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
 * Shrunk case: n2 keeps a reference after its last consumer is gone, because a
 * deferred release treated an effect as owner of an edge linked after that
 * effect ran.
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
 * Shrunk case that passes at the baseline commit 3c389f7 and guards the
 * flush-end closure extension: n4 links n3 beneath itself in a flush where its
 * effect does not rerun. A closure taken only when the effect runs would
 * unmount n0 while n4 still reads it.
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
				[releaseOrderExample],
				[danglingMountExample],
				[unmountOrderExample],
				[lateLinkedOwnerExample],
				[lateLinkedReaderExample],
			],
		},
	)
})
