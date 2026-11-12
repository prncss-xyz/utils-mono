import { describe, expect, it } from 'vitest'

import {
	atomFamily,
	derivedAtom,
	effectAtom,
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
	inspect,
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
	it('runs each getter of a diamond once across repeated reads', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const store = createStore()
		expect(store.peek(top)).toBe(1)
		const instrumentation = countOperations(store)
		const reads: number[] = []
		const setter = derivedAtom(null, (read, write) => {
			write(source, 1)
			reads.push(read(top), read(top), read(top))
		})
		store.send(setter)
		expect(reads).toEqual([41, 41, 41])
		expect(countsByName(instrumentation, 'pendingGetters')).toEqual(
			eachDiamondNode(1),
		)
		expect(store.peek(top)).toBe(1)
		await flushMicrotask()
		expect(store.peek(top)).toBe(41)
	})

	it('recomputes a diamond read after each write', async () => {
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
		['transient', TRANSIENT, 3],
		['retained', Infinity, 1],
	])(
		'evaluates %s family members once per resolved instance across reads',
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
				reads.push(read(pair), read(pair), read(members, 1))
			})
			store.send(setter)
			expect(reads).toEqual([4, 4, 2])
			expect(countsByName(instrumentation, 'pendingGetters')).toEqual({
				member: memberEvaluations,
				pair: 1,
			})
		},
	)

	it('recomputes after a write made by a nested setter', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const bump = derivedAtom(null, (read, write) =>
			write(source, read(source) + 1),
		)
		const reads: number[] = []
		const setter = derivedAtom(null, (read, write) => {
			write(source, 1)
			reads.push(read(top))
			write(bump)
			reads.push(read(top), read(top))
		})
		const store = createStore()
		const instrumentation = countOperations(store)
		store.send(setter)
		expect(reads).toEqual([41, 81, 81])
		expect(countsByName(instrumentation, 'pendingGetters')).toEqual(
			eachDiamondNode(2),
		)
		expect(store.peek(top)).toBe(1)
		await flushMicrotask()
		expect(store.peek(top)).toBe(81)
	})

	it('runs each getter once for repeated reads made by a setter during hydration', () => {
		const source = primitiveAtom(0)
		const evaluations: Record<string, number> = {}
		const top = diamond(source, (name) => {
			evaluations[name] = (evaluations[name] ?? 0) + 1
		})
		const recorded = primitiveAtom(0)
		const record = derivedAtom(null, (read, write) =>
			write(recorded, read(top) + read(top)),
		)
		const store = createStore([[source, 1], [record]])
		expect(evaluations).toEqual(eachDiamondNode(1))
		expect(store.peek(recorded)).toBe(82)
	})

	it('runs each getter once for repeated reads made by a setter in a mount write', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const recorded = primitiveAtom(0)
		const record = derivedAtom(null, (read, write) =>
			write(recorded, read(top) + read(top)),
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
		expect(store.peek(recorded)).toBe(82)
		expect(store.peek(top)).toBe(41)
	})

	it('does not reuse values of pending writes queued before a mount write', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const other = primitiveAtom(0)
		const reads: number[] = []
		const writeAndRead = derivedAtom(null, (read, write, next: number) => {
			write(source, next)
			reads.push(read(top))
		})
		const mounted = primitiveAtom(0, {
			onMount: (_read, write) => {
				write(other, 1)
				write(derivedAtom(null, (read) => reads.push(read(top))))
			},
		})
		const store = createStore()
		store.subscribe(source, () => store.send(writeAndRead, 2))
		await flushMicrotask()
		store.send(source, 1)
		store.subscribe(mounted, () => {})
		await flushMicrotask()
		expect(reads).toEqual([81, 41])
		expect(store.peek(top)).toBe(41)
		await flushMicrotask()
		expect(store.peek(top)).toBe(81)
	})

	it('does not reuse values that read a family member evicted since', async () => {
		let firstInstance = true
		const members = atomFamily(
			() => {
				const initial = firstInstance ? 5 : 0
				firstInstance = false
				return primitiveAtom(initial)
			},
			{
				TTL: 0,
			},
		)
		const other = primitiveAtom(0)
		const trigger = primitiveAtom(0)
		const total = derivedAtom((read) => read(members, 1) + read(other))
		const reads: number[] = []
		const readTotal = derivedAtom(null, (read) => reads.push(read(total)))
		const writeAndRead = derivedAtom(null, (read, write) => {
			write(other, 1)
			reads.push(read(total))
		})
		const store = createStore()
		const unsubscribeMember = store.subscribe(members, 1, () => {})
		store.subscribe(trigger, () => {
			void Promise.resolve().then(() => store.send(readTotal))
			store.send(writeAndRead)
		})
		await flushMicrotask()
		unsubscribeMember()
		store.send(trigger, 1)
		await flushMicrotask()
		await flushMicrotask()
		expect(reads).toEqual([6, 1])
	})

	it('reuses pending values read during delivery in the next effect but not across effects', async () => {
		const root = primitiveAtom(0)
		const other = primitiveAtom(0)
		const doubled = derivedAtom((read) => read(other) * 2, null, {
			name: 'doubled',
		})
		const reads: number[] = []
		const readDoubled = derivedAtom(null, (read) => reads.push(read(doubled)))
		const store = createStore()
		store.subscribe(root, () => {
			store.send(other, 1)
			store.send(readDoubled)
		})
		store.mountEffect(
			effectAtom((read) => {
				store.send(readDoubled)
				read(root)
				store.send(readDoubled)
			}),
		)
		store.mountEffect(
			effectAtom((read) => {
				store.send(readDoubled)
				read(root)
			}),
		)
		await flushMicrotask()
		reads.length = 0
		const instrumentation = countOperations(store)
		store.send(root, 1)
		await flushMicrotask()
		expect(reads).toEqual([2, 2, 2, 2])
		expect(countsByName(instrumentation, 'pendingGetters')).toEqual({
			doubled: 3,
		})
	})

	it('drops pending values at commit when no committed value changes', async () => {
		const source = primitiveAtom(0)
		const top = diamond(source)
		const setter = derivedAtom(null, (read, write) => {
			write(source, 0)
			read(top)
		})
		const store = createStore()
		store.send(setter)
		expect(inspect(store).pendingValues?.size).toBe(4)
		await flushMicrotask()
		expect(inspect(store).pendingValues).toBeUndefined()
	})
})
