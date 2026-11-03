import fc from 'fast-check'
import { expect, it } from 'vitest'

import {
	createStore,
	derivedAtom,
	primitiveAtom,
	type AtomSymbol,
	type Read,
	type Write,
} from '.'
import { RESET } from '../../functions'
import { type Value } from './utils.testing'

const PRIMITIVES = 3
const small = fc.integer({ min: 0, max: 4 })
const primitive = fc.integer({ min: 0, max: PRIMITIVES - 1 })

type PrimitiveEvent =
	| { type: 'value'; value: number }
	| { type: 'update'; delta: number }
	| { type: 'reset' }
const event: fc.Arbitrary<PrimitiveEvent> = fc.oneof(
	fc.record({ type: fc.constant('value' as const), value: small }),
	fc.record({ type: fc.constant('update' as const), delta: small }),
	fc.record({ type: fc.constant('reset' as const) }),
)

type Send =
	| { type: 'setter'; index: number; argument: number }
	| { type: 'primitive'; index: number; event: PrimitiveEvent }

type SetterSpec =
	| { type: 'copy'; target: number; source: number; add: number }
	| { type: 'bump'; target: number; source: number }
	| { type: 'reset'; target: number }
	| { type: 'chain'; other: number; target: number; source: number }

const setterDraft = fc.record({
	type: fc.constantFrom('copy', 'bump', 'reset', 'chain'),
	target: primitive,
	source: fc.nat({ max: 20 }),
	add: small,
	other: fc.nat({ max: 20 }),
})

function setterSpec(
	draft: Value<typeof setterDraft>,
	index: number,
	nodeCount: number,
): SetterSpec {
	const { type, target, add } = draft
	const source = draft.source % nodeCount
	switch (type) {
		case 'copy':
			return { type, target, source, add }
		case 'bump':
			return { type, target, source }
		case 'reset':
			return { type, target }
		case 'chain':
			return index === 0
				? { type: 'reset', target }
				: { type, other: draft.other % index, target, source }
	}
}

const graph = fc
	.record({
		initial: fc.array(small, {
			minLength: PRIMITIVES,
			maxLength: PRIMITIVES,
		}),
		readers: fc.array(
			fc.record({
				a: fc.nat({ max: 20 }),
				b: fc.nat({ max: 20 }),
				weight: fc.integer({ min: 1, max: 3 }),
			}),
			{ minLength: 1, maxLength: 4 },
		),
		setters: fc.array(setterDraft, { minLength: 1, maxLength: 4 }),
	})
	.map(({ initial, readers, setters }) => {
		const nodeCount = PRIMITIVES + readers.length
		return {
			initial,
			readers: readers.map(({ a, b, weight }, index) => ({
				a: a % (PRIMITIVES + index),
				b: b % (PRIMITIVES + index),
				weight,
			})),
			setters: setters.map((draft, index) =>
				setterSpec(draft, index, nodeCount),
			),
		}
	})

type Graph = Value<typeof graph>

const scenario = graph.chain((graph) => {
	const nodeCount = PRIMITIVES + graph.readers.length
	const send = fc.oneof(
		fc.record({
			type: fc.constant('primitive' as const),
			index: primitive,
			event,
		}),
		fc.record({
			type: fc.constant('setter' as const),
			index: fc.nat({ max: graph.setters.length - 1 }),
			argument: small,
		}),
	)
	return fc.record({
		graph: fc.constant(graph),
		operations: fc.array(
			fc.oneof(
				{
					weight: 8,
					arbitrary: fc.record({
						type: fc.constant('send' as const),
						send,
					}),
				},
				{
					weight: 3,
					arbitrary: fc.record({
						type: fc.constant('subscribe' as const),
						primitive,
						bumps: primitive,
					}),
				},
				{
					weight: 2,
					arbitrary: fc.record({
						type: fc.constant('unsubscribe' as const),
						slot: fc.nat({ max: 20 }),
					}),
				},
				{
					weight: 5,
					arbitrary: fc.record({ type: fc.constant('yield' as const) }),
				},
				{
					weight: 3,
					arbitrary: fc.record({
						type: fc.constant('peek' as const),
						node: fc.nat({ max: nodeCount - 1 }),
					}),
				},
			),
			{ maxLength: 40, size: 'max' },
		),
	})
})

type Context = {
	read: (node: number) => number
	send: (action: Send) => void
	trace: string[]
}

/** The setters under test: the same logic runs against the store and the model. */
function runSetter(spec: SetterSpec, context: Context, argument: number) {
	const { read, send, trace } = context
	const observe = (node: number) => {
		const value = read(node)
		trace.push(`read n${node}=${value}`)
		return value
	}
	switch (spec.type) {
		case 'copy':
			return send({
				type: 'primitive',
				index: spec.target,
				event: {
					type: 'value',
					value: observe(spec.source) + spec.add + argument,
				},
			})
		case 'bump':
			return send({
				type: 'primitive',
				index: spec.target,
				event: { type: 'update', delta: observe(spec.source) },
			})
		case 'reset':
			return send({
				type: 'primitive',
				index: spec.target,
				event: { type: 'reset' },
			})
		case 'chain':
			send({ type: 'setter', index: spec.other, argument })
			return send({
				type: 'primitive',
				index: spec.target,
				event: { type: 'value', value: observe(spec.source) },
			})
	}
}

function readerValue(
	graph: Graph,
	node: number,
	primitiveValue: (index: number) => number,
): number {
	if (node < PRIMITIVES) return primitiveValue(node)
	const { a, b, weight } = graph.readers[node - PRIMITIVES]!
	return (
		readerValue(graph, a, primitiveValue) * weight +
		readerValue(graph, b, primitiveValue)
	)
}

async function run(
	graph: Graph,
	operations: readonly Value<typeof scenario>['operations'][number][],
) {
	const store = createStore()
	const primitives = graph.initial.map((initial) => primitiveAtom(initial))
	const nodes: AtomSymbol<number, never>[] = [...primitives] as never
	for (const { a, b, weight } of graph.readers)
		nodes.push(derivedAtom((get) => get(nodes[a]!) * weight + get(nodes[b]!)))
	const realTrace: string[] = []
	const setters: AtomSymbol<never, [number]>[] = []
	const realContext = (read: Read, write: Write): Context => ({
		read: (node) => read(nodes[node]!),
		send: (action) => {
			if (action.type === 'setter')
				return write(setters[action.index]!, action.argument)
			const atom = primitives[action.index]!
			const { event } = action
			switch (event.type) {
				case 'value':
					return write(atom, event.value)
				case 'update':
					return write(atom, (value) => {
						realTrace.push(`update n${action.index} from ${value}`)
						return value + event.delta
					})
				case 'reset':
					return write(atom, RESET)
			}
		},
		trace: realTrace,
	})
	for (const spec of graph.setters)
		setters.push(
			derivedAtom<never, [number]>(null, (read, write, argument) =>
				runSetter(spec, realContext(read, write), argument),
			),
		)

	const committed = [...graph.initial]
	const pending = new Map<number, number>()
	const modelTrace: string[] = []
	const overlay = (index: number) =>
		pending.has(index) ? pending.get(index)! : committed[index]!
	const modelContext: Context = {
		read: (node) => readerValue(graph, node, overlay),
		send: (action) => {
			if (action.type === 'setter')
				return runSetter(
					graph.setters[action.index]!,
					modelContext,
					action.argument,
				)
			const { event, index } = action
			switch (event.type) {
				case 'value':
					return void pending.set(index, event.value)
				case 'update': {
					modelTrace.push(`update n${index} from ${overlay(index)}`)
					return void pending.set(index, overlay(index) + event.delta)
				}
				case 'reset':
					return void pending.set(index, graph.initial[index]!)
			}
		},
		trace: modelTrace,
	}

	const subscriptions: {
		primitive: number
		bumps: number
		release: () => void
	}[] = []
	const history: string[] = []
	const report = (label: string) => `${label}\n${history.join('\n')}`
	const checkCommitted = (step: string) => {
		for (const [node, atom] of nodes.entries())
			expect(store.peek(atom), report(`${step}: peek n${node}`)).toBe(
				readerValue(graph, node, (index) => committed[index]!),
			)
	}

	try {
		for (const [index, operation] of operations.entries()) {
			const step = `step ${index} ${JSON.stringify(operation)}`
			history.push(step)
			switch (operation.type) {
				case 'send': {
					realTrace.length = 0
					modelTrace.length = 0
					realContext(store.peek, store.send).send(operation.send)
					modelContext.send(operation.send)
					expect(realTrace, report(`${step}: values seen by setters`)).toEqual(
						modelTrace,
					)
					checkCommitted(step)
					break
				}
				case 'subscribe': {
					const { primitive: watched, bumps } = operation
					subscriptions.push({
						primitive: watched,
						bumps,
						release: store.subscribe(primitives[watched]!, () => {
							store.send(primitives[bumps]!, (value) => value + 1)
						}),
					})
					break
				}
				case 'unsubscribe': {
					if (subscriptions.length === 0) break
					subscriptions
						.splice(operation.slot % subscriptions.length, 1)[0]!
						.release()
					break
				}
				case 'peek':
					checkCommitted(step)
					break
				case 'yield': {
					const batch = [...pending]
					pending.clear()
					const before = [...committed]
					for (const [index, next] of batch) committed[index] = next
					for (const { primitive: watched, bumps } of subscriptions)
						if (!Object.is(before[watched], committed[watched]))
							pending.set(bumps, overlay(bumps) + 1)
					await Promise.resolve()
					checkCommitted(step)
					break
				}
			}
		}
	} finally {
		for (const { release } of subscriptions) release()
	}
}

it('applies one batch per microtask and shows setters the pending view', async () => {
	await fc.assert(
		fc.asyncProperty(scenario, ({ graph, operations }) =>
			run(graph, operations),
		),
		{ numRuns: 1000 },
	)
})
