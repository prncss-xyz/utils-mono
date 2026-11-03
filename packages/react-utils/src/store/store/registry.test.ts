import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

import { atomFamily, primitiveAtom, TRANSIENT } from '../atoms'
import { evict, getInstance } from './registry'
import { createStubState } from './utils.testing'

describe('family resolution', () => {
	const operation = fc.oneof(
		{
			weight: 4,
			arbitrary: fc.record({
				type: fc.constant('get' as const),
				key: fc.integer({ min: 0, max: 30 }),
			}),
		},
		{
			weight: 1,
			arbitrary: fc.record({
				type: fc.constant('evict' as const),
				slot: fc.nat({ max: 10 }),
			}),
		},
	)

	const hashOf = (key: number) => Math.floor(key / 4)
	const near = (a: number, b: number) => Math.abs(a - b) <= 5

	it.each([
		[
			'hash',
			{ hash: hashOf },
			(stored: number, key: number) => hashOf(stored) === hashOf(key),
		],
		['eq', { eq: near }, near],
	] as const)(
		'returns the entry the %s lookup selects and creates one per miss',
		(_mode, lookup, matches) => {
			fc.assert(
				fc.property(fc.array(operation, { maxLength: 40 }), (operations) => {
					const created: number[] = []
					const family = atomFamily(
						(key: number) => {
							created.push(key)
							return primitiveAtom(key)
						},
						{ TTL: 0, ...lookup } as never,
					)
					const current = createStubState()
					const stored: { key: number; instance: unknown }[] = []
					let evicted = 0
					for (const step of operations) {
						if (step.type === 'evict') {
							if (stored.length === 0) continue
							const { instance } = stored.splice(
								step.slot % stored.length,
								1,
							)[0]!
							evict(current, instance as never)
							evicted++
							continue
						}
						const hit = stored.find(({ key }) => matches(key, step.key))
						const instance = getInstance(current, family, step.key)
						if (hit) expect(instance).toBe(hit.instance)
						else stored.push({ key: step.key, instance })
						expect(created).toHaveLength(stored.length + evicted)
					}
					expect(new Set(stored.map(({ instance }) => instance)).size).toBe(
						stored.length,
					)
				}),
				{ numRuns: 300 },
			)
		},
	)

	it('never stores members of a transient family', () => {
		const create = vi.fn((key: string) => primitiveAtom(key))
		const family = atomFamily(create, { TTL: TRANSIENT })
		const current = createStubState()

		const first = getInstance(current, family, 'a')
		expect(getInstance(current, family, 'a')).not.toBe(first)
		expect(create).toHaveBeenCalledTimes(2)
		expect(current.families.has(family)).toBe(false)
	})

	it.each([
		['the same symbol for different keys', undefined, 'first', 'second'],
		[
			'an already used symbol for a transient family',
			{ TTL: TRANSIENT },
			'first',
			'first',
		],
	] as const)(
		'rejects a create factory that returns %s',
		(_label, options, first, second) => {
			const shared = primitiveAtom(0)
			const family = atomFamily((_key: string) => shared, options)
			const current = createStubState()

			getInstance(current, family, first)
			expect(() => getInstance(current, family, second)).toThrow(
				'atomFamily create must return a fresh symbol on every call',
			)
		},
	)

	it('rejects a create factory that returns an already used symbol after eviction', () => {
		const shared = primitiveAtom(0)
		const family = atomFamily((_key: string) => shared)
		const current = createStubState()

		evict(current, getInstance(current, family, 'first'))
		expect(() => getInstance(current, family, 'first')).toThrow(
			'atomFamily create must return a fresh symbol on every call',
		)
	})

	it('rejects a symbol that was already used directly', () => {
		const shared = primitiveAtom(0)
		const family = atomFamily((_key: string) => shared)
		const current = createStubState()

		getInstance(current, shared)
		expect(() => getInstance(current, family, 'a')).toThrow(
			'atomFamily create must return a fresh symbol on every call',
		)
	})
})
