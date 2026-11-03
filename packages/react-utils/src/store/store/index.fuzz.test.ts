import fc from 'fast-check'
import { expect, it } from 'vitest'

import { createStore, derivedAtom, primitiveAtom, type AtomSymbol } from '.'

const value = fc.integer({ min: 0, max: 4 })
const dependency = fc.integer({ min: 0, max: 9 })
const graph = fc
	.record({
		primitives: fc.array(value, { minLength: 1, maxLength: 3, size: 'max' }),
		derived: fc.array(
			fc.record({
				a: dependency,
				b: dependency,
				c: dependency,
				modulus: fc.integer({ min: 2, max: 4 }),
			}),
			{ minLength: 1, maxLength: 8, size: 'max' },
		),
	})
	.map(({ primitives, derived }) => ({
		primitives,
		derived: derived.map(({ a, b, c, modulus }, index) => ({
			a: a % (primitives.length + index),
			b: b % (primitives.length + index),
			c: c % (primitives.length + index),
			modulus,
		})),
	}))

const scenario = graph.chain((graph) => {
	const primitive = fc.integer({ min: 0, max: graph.primitives.length - 1 })
	const derived = fc.integer({ min: 0, max: graph.derived.length - 1 })
	const read = fc.record({ type: fc.constant('read'), derived })
	const operation = fc.oneof(
		{
			weight: 6,
			arbitrary: fc.record({ type: fc.constant('write'), primitive, value }),
		},
		{
			weight: 3,
			arbitrary: fc.record({ type: fc.constant('subscribe'), derived }),
		},
		{
			weight: 2,
			arbitrary: fc.record({
				type: fc.constant('unsubscribe'),
				slot: fc.integer({ min: 0, max: 59 }),
			}),
		},
		{ weight: 4, arbitrary: fc.record({ type: fc.constant('yield') }) },
		{ weight: 5, arbitrary: read },
	)
	return fc
		.tuple(fc.array(operation, { maxLength: 59, size: 'max' }), read)
		.map(([operations, finalRead]) => ({
			graph,
			operations: [...operations, finalRead],
		}))
})

it('matches a reference evaluation across random derived graphs', async () => {
	await fc.assert(
		fc.asyncProperty(scenario, async ({ graph, operations }) => {
			const store = createStore()
			const primitives = graph.primitives.map((initial) =>
				primitiveAtom(initial),
			)
			const nodes = [...primitives] as AtomSymbol<number, never>[]
			for (const { a, b, c, modulus } of graph.derived) {
				nodes.push(
					derivedAtom((get) =>
						get(nodes[a]!) % modulus === 0
							? get(nodes[b]!)
							: get(nodes[c]!) % modulus,
					),
				)
			}
			const expected = [...graph.primitives]
			const pending = new Map<number, number>()
			const reference = (index: number): number => {
				if (index < primitives.length) return expected[index]!
				const { a, b, c, modulus } = graph.derived[index - primitives.length]!
				return reference(a) % modulus === 0
					? reference(b)
					: reference(c) % modulus
			}
			const unsubscribes: (() => void)[] = []
			try {
				for (const [step, operation] of operations.entries()) {
					switch (operation.type) {
						case 'write':
							store.send(primitives[operation.primitive]!, operation.value)
							pending.set(operation.primitive, operation.value)
							break
						case 'subscribe':
							unsubscribes.push(
								store.subscribe(
									nodes[primitives.length + operation.derived]!,
									() => {},
								),
							)
							break
						case 'unsubscribe':
							/** Select an active subscription modulo its count; no active subscriptions means no-op. */
							if (unsubscribes.length > 0)
								unsubscribes.splice(
									operation.slot % unsubscribes.length,
									1,
								)[0]!()
							break
						case 'yield':
							await Promise.resolve()
							for (const [index, next] of pending) expected[index] = next
							pending.clear()
							break
						case 'read': {
							for (const [index, primitive] of primitives.entries())
								expect(
									store.peek(primitive),
									`step ${step} primitive ${index}`,
								).toBe(expected[index])
							const index = primitives.length + operation.derived
							expect(
								store.peek(nodes[index]!),
								`step ${step} node ${index}`,
							).toBe(reference(index))
							break
						}
					}
				}
			} finally {
				for (const unsubscribe of unsubscribes) unsubscribe()
				await Promise.resolve()
			}
		}),
		{ numRuns: 2000 },
	)
})
