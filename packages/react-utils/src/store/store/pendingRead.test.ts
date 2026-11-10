import { describe, expect, it } from 'vitest'

import {
	atomFamily,
	derivedAtom,
	primitiveAtom,
	TRANSIENT,
	type AtomSymbol,
	type Read,
} from '.'
import {
	countOperations,
	countsByName,
	createStore,
	flushMicrotask,
} from './utils.testing'

/**
 * A diamond over `source` whose shared `base` is read by every other node,
 * twice by `right`. Its value is `40 * source + 1`.
 */
function diamond(
	source: AtomSymbol<number, any>,
	evaluated: (name: string) => void = () => {},
) {
	const node = (name: string, getter: (read: Read) => number) =>
		derivedAtom(
			(read) => {
				evaluated(name)
				return getter(read)
			},
			null,
			{ name },
		)
	const base = node('base', (read) => read(source) * 10)
	const left = node('left', (read) => read(base) + 1)
	const right = node('right', (read) => read(base) + read(base))
	return node('top', (read) => read(left) + read(right) + read(base))
}

const eachDiamondNode = (evaluations: number) => ({
	base: evaluations,
	left: evaluations,
	right: evaluations,
	top: evaluations,
})

describe('pending reads', () => {
	it('runs each getter of a diamond once per read and recomputes it on the next read', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const store = createStore()
		expect(store.peek(top)).toBe(1)
		const instrumentation = countOperations(store)
		const reads: number[] = []
		const setter = derivedAtom(null, (read, write) => {
			write(source, 1)
			reads.push(read(top))
			write(source, 2)
			reads.push(read(top))
		})
		store.send(setter)
		expect(reads).toEqual([41, 81])
		expect(countsByName(instrumentation, 'pendingGetters')).toEqual(
			eachDiamondNode(2),
		)
		expect(store.peek(top)).toBe(1)
		await flushMicrotask()
		expect(store.peek(top)).toBe(81)
	})

	it.each([
		['transient', TRANSIENT, 2],
		['retained', Infinity, 1],
	])(
		'evaluates %s family members once per resolved instance',
		(_retention, TTL, memberEvaluations) => {
			const source = primitiveAtom(0)
			const members = atomFamily(
				(key: number) =>
					derivedAtom((read) => read(source) + key, null, { name: 'member' }),
				{ TTL },
			)
			const pair = derivedAtom(
				(read) => read(members, 1) + read(members, 1),
				null,
				{ name: 'pair' },
			)
			const store = createStore()
			const instrumentation = countOperations(store)
			const reads: number[] = []
			const setter = derivedAtom(null, (read, write) => {
				write(source, 1)
				reads.push(read(pair))
			})
			store.send(setter)
			expect(reads).toEqual([4])
			expect(countsByName(instrumentation, 'pendingGetters')).toEqual({
				member: memberEvaluations,
				pair: 1,
			})
		},
	)

	it('memoizes each read of nested setters separately', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const recorded = primitiveAtom(0)
		const record = derivedAtom(null, (read, write) =>
			write(recorded, read(top)),
		)
		const reads: number[] = []
		const setter = derivedAtom(null, (read, write) => {
			write(source, 1)
			write(record)
			write(source, 2)
			reads.push(read(top))
		})
		const store = createStore()
		const instrumentation = countOperations(store)
		store.send(setter)
		expect(reads).toEqual([81])
		expect(countsByName(instrumentation, 'pendingGetters')).toEqual(
			eachDiamondNode(2),
		)
		expect(store.peek(recorded)).toBe(0)
		await flushMicrotask()
		expect(store.peek(recorded)).toBe(41)
	})

	it('runs each getter once for a read made by a setter during hydration', () => {
		const source = primitiveAtom(0)
		const evaluations: Record<string, number> = {}
		const top = diamond(source, (name) => {
			evaluations[name] = (evaluations[name] ?? 0) + 1
		})
		const recorded = primitiveAtom(0)
		const record = derivedAtom(null, (read, write) =>
			write(recorded, read(top)),
		)
		const store = createStore([[source, 1], [record]])
		expect(evaluations).toEqual(eachDiamondNode(1))
		expect(store.peek(recorded)).toBe(41)
	})

	it('runs each getter once for a read made by a setter in a mount write', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const recorded = primitiveAtom(0)
		const record = derivedAtom(null, (read, write) =>
			write(recorded, read(top)),
		)
		const committed: number[] = []
		const mounted = primitiveAtom(0, {
			onMount: (read, write) => {
				write(source, 1)
				write(record)
				committed.push(read(top))
			},
		})
		const store = createStore()
		const instrumentation = countOperations(store)
		store.subscribe(mounted, () => {})
		await flushMicrotask()
		expect(committed).toEqual([1])
		expect(countsByName(instrumentation, 'pendingGetters')).toEqual(
			eachDiamondNode(1),
		)
		expect(store.peek(recorded)).toBe(41)
		expect(store.peek(top)).toBe(41)
	})
})
