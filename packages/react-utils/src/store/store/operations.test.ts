import { describe, expect, it } from 'vitest'

import { derivedAtom, effectAtom, primitiveAtom, type AtomSymbol } from '.'
import {
	countOperations,
	createOperationCounts,
	createStore,
	inspect,
	stopCountingOperations,
	type Instrumentation,
	type OperationCounts,
} from './utils.testing'

const flushMicrotask = () => Promise.resolve()

const counts = (overrides: Partial<OperationCounts>): OperationCounts => ({
	...createOperationCounts(),
	...overrides,
})

const named = (instrumentation: Instrumentation) =>
	Object.fromEntries(instrumentation.byName)

function layeredGraph(source: AtomSymbol<number, any>) {
	let layer: AtomSymbol<number, never>[] = [source as AtomSymbol<number, never>]
	for (let level = 0; level < 10; level++) {
		const previous = layer
		layer = Array.from({ length: 2 }, () =>
			derivedAtom((read) =>
				previous.reduce((sum, atom) => sum + read(atom), 0),
			),
		)
	}
	const tip = layer
	return derivedAtom((read) => tip.reduce((sum, atom) => sum + read(atom), 0))
}

function chain(source: AtomSymbol<number, any>, length: number) {
	let tip = derivedAtom((read) => read(source) + 1)
	for (let index = 1; index < length; index++) {
		const previous = tip
		tip = derivedAtom((read) => read(previous) + 1)
	}
	return tip
}

describe('operation counts', () => {
	it('counts nothing until enabled and stops when disabled', async () => {
		const source = primitiveAtom(0)
		const derived = derivedAtom((read) => read(source) + 1)
		const store = createStore()
		store.subscribe(derived, () => {})
		store.send(source, 1)
		await flushMicrotask()
		expect(inspect(store).instrumentation).toBeUndefined()
		const { totals } = countOperations(store)
		stopCountingOperations(store)
		store.send(source, 2)
		await flushMicrotask()
		expect(store.peek(derived)).toBe(3)
		expect(totals).toEqual(counts({}))
		expect(inspect(store).instrumentation).toBeUndefined()
	})

	it('counts each operation kind in total and by atom name', async () => {
		const source = primitiveAtom(0, { name: 'source' })
		const doubled = derivedAtom((read) => read(source) * 2, null, {
			name: 'doubled',
			onMount: (_read, _write, mountEffect) => {
				mountEffect(effectAtom((get) => get(source), () => () => {}))
				return () => {}
			},
		})
		const unmounted = derivedAtom((read) => read(source) + 1, null, {
			name: 'unmounted',
		})
		const seen: number[] = []
		const setter = derivedAtom(null, (read, write) => {
			write(source, 1)
			seen.push(read(unmounted))
		})
		const store = createStore()
		expect(store.peek(unmounted)).toBe(1)
		const instrumentation = countOperations(store)
		const dispose = store.subscribe(doubled, () => {})
		await flushMicrotask()
		store.send(setter)
		await flushMicrotask()
		expect(store.peek(unmounted)).toBe(2)
		dispose()
		expect(seen).toEqual([2])
		expect(instrumentation.totals).toEqual(
			counts({
				getters: 3,
				pendingGetters: 1,
				invalidations: 3,
				validations: 1,
				notifications: 1,
				effects: 3,
				cleanups: 3,
			}),
		)
		expect(named(instrumentation)).toEqual({
			source: { invalidations: 1 },
			doubled: {
				getters: 2,
				invalidations: 1,
				notifications: 1,
				cleanups: 1,
			},
			unmounted: { getters: 1, pendingGetters: 1, validations: 1 },
		})
	})

	it('holds only numbers and names, never instances or symbols', async () => {
		const source = primitiveAtom(0, { name: 'source' })
		const store = createStore()
		const instrumentation = countOperations(store)
		for (let key = 0; key < 10; key++) {
			const derived = derivedAtom((read) => read(source) + key, null, {
				name: `derived ${key}`,
			})
			store.subscribe(derived, () => {})()
		}
		store.send(source, 1)
		await flushMicrotask()
		const isCounts = (value: unknown) =>
			typeof value === 'object' &&
			value !== null &&
			Object.getPrototypeOf(value) === Object.prototype &&
			Object.values(value).every((count) => typeof count === 'number')
		expect(Object.keys(instrumentation)).toEqual(['totals', 'byName'])
		expect(isCounts(instrumentation.totals)).toBe(true)
		expect(instrumentation.byName.size).toBe(11)
		for (const [name, value] of instrumentation.byName) {
			expect(typeof name).toBe('string')
			expect(isCounts(value)).toBe(true)
		}
	})

	it('runs 1,001 getters and 1,000 callbacks when an equal-parity fanout keeps its values', async () => {
		const source = primitiveAtom(0)
		const parity = derivedAtom((read) => read(source) % 2)
		const consumers = Array.from({ length: 1_000 }, () =>
			derivedAtom((read) => read(parity) + 1),
		)
		const store = createStore()
		for (const consumer of consumers) store.subscribe(consumer, () => {})
		await flushMicrotask()
		const { totals } = countOperations(store)
		store.send(source, 2)
		await flushMicrotask()
		expect(consumers.every((consumer) => store.peek(consumer) === 1)).toBe(true)
		expect(totals).toEqual(
			counts({ getters: 1_001, invalidations: 1_002, notifications: 1_000 }),
		)
	})

	it('runs 2,047 pending getters on each read of a 21-node layered graph', async () => {
		const source = primitiveAtom(0)
		const top = layeredGraph(source)
		const reads: number[] = []
		const setter = derivedAtom(null, (read, write) => {
			write(source, 1)
			reads.push(read(top))
			reads.push(read(top))
		})
		const store = createStore()
		expect(store.peek(top)).toBe(0)
		const { totals } = countOperations(store)
		store.send(setter)
		expect(totals.pendingGetters).toBe(2 * 2_047)
		expect(reads).toEqual([1_024, 1_024])
		expect(store.peek(top)).toBe(0)
		await flushMicrotask()
		expect(store.peek(top)).toBe(1_024)
		expect(totals).toEqual(
			counts({
				getters: 21,
				pendingGetters: 2 * 2_047,
				invalidations: 1,
				validations: 21,
			}),
		)
	})

	it('validates each of 100 unmounted chain nodes without running getters after an unrelated write', async () => {
		const source = primitiveAtom(0)
		const unrelated = primitiveAtom(0)
		const tip = chain(source, 100)
		const store = createStore()
		expect(store.peek(tip)).toBe(100)
		const { totals } = countOperations(store)
		store.send(unrelated, 1)
		await flushMicrotask()
		expect(store.peek(tip)).toBe(100)
		expect(totals).toEqual(counts({ invalidations: 1, validations: 100 }))
	})
})
