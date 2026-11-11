import { describe, expect, it } from 'vitest'

import { derivedAtom, effectAtom, primitiveAtom } from '.'
import {
	chain,
	countOperations,
	countsByName,
	createOperationCounts,
	createStore,
	inspect,
	layeredGraph,
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
				mountEffect(
					effectAtom(
						(read) => read(source),
						() => () => {},
					),
				)
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

	it('runs only the intermediate getter and notifies no subscriber when an equal-parity fanout keeps its values', async () => {
		const source = primitiveAtom(0)
		const parity = derivedAtom((read) => read(source) % 2, null, {
			name: 'parity',
		})
		const consumers = Array.from({ length: 1_000 }, () =>
			derivedAtom((read) => read(parity) + 1),
		)
		const store = createStore()
		for (const consumer of consumers) store.subscribe(consumer, () => {})
		await flushMicrotask()
		const instrumentation = countOperations(store)
		store.send(source, 2)
		await flushMicrotask()
		expect(consumers.every((consumer) => store.peek(consumer) === 1)).toBe(true)
		expect(countsByName(instrumentation, 'getters')).toEqual({ parity: 1 })
		expect(instrumentation.totals).toEqual(
			counts({
				getters: 1,
				invalidations: 1_002,
				validations: 1_000,
			}),
		)
	})

	it.each([
		{
			title: 'reads the source first',
			sum: (source: () => number, doubled: () => number) =>
				source() + doubled(),
		},
		{
			title: 'reads the derived dependency first',
			sum: (source: () => number, doubled: () => number) =>
				doubled() + source(),
		},
	])(
		'reruns a direct consumer without validating it when it $title',
		async ({ sum }) => {
			const source = primitiveAtom(0)
			const doubled = derivedAtom((read) => read(source) * 2)
			const consumer = derivedAtom((read) =>
				sum(
					() => read(source),
					() => read(doubled),
				),
			)
			const store = createStore()
			store.subscribe(consumer, () => {})
			await flushMicrotask()
			const { totals } = countOperations(store)
			store.send(source, 1)
			await flushMicrotask()
			expect(store.peek(consumer)).toBe(3)
			expect(totals).toEqual(
				counts({ getters: 2, invalidations: 3, notifications: 1 }),
			)
		},
	)

	it.each([
		{
			title: 'NaN to NaN',
			map: (input: number) => Math.sqrt(-input),
			from: 1,
			to: 2,
			value: NaN,
			getters: { intermediate: 1 },
		},
		{
			title: '0 to -0',
			map: (input: number) => input * 0,
			from: 1,
			to: -1,
			value: -Infinity,
			getters: { intermediate: 1, sink: 1 },
		},
		{
			title: '-0 to 0',
			map: (input: number) => input * 0,
			from: -1,
			to: 1,
			value: Infinity,
			getters: { intermediate: 1, sink: 1 },
		},
	])(
		'compares a mounted intermediate value with Object.is from $title',
		async ({ map, from, to, value, getters }) => {
			const source = primitiveAtom(from)
			const intermediate = derivedAtom((read) => map(read(source)), null, {
				name: 'intermediate',
			})
			const sink = derivedAtom((read) => 1 / read(intermediate), null, {
				name: 'sink',
			})
			const store = createStore()
			store.subscribe(sink, () => {})
			await flushMicrotask()
			const instrumentation = countOperations(store)
			store.send(source, to)
			await flushMicrotask()
			expect(store.peek(sink)).toBe(value)
			expect(countsByName(instrumentation, 'getters')).toEqual(getters)
		},
	)

	it('runs each getter of a 21-node layered graph once across repeated pending reads', async () => {
		const source = primitiveAtom(0)
		const top = layeredGraph(source)
		const reads: number[] = []
		const store = createStore()
		expect(store.peek(top)).toBe(0)
		const instrumentation = countOperations(store)
		const { totals } = instrumentation
		const setter = derivedAtom(null, (read, write) => {
			write(source, 1)
			reads.push(read(top), read(top))
		})
		store.send(setter)
		expect(reads).toEqual([1_024, 1_024])
		expect(store.peek(top)).toBe(0)
		await flushMicrotask()
		expect(store.peek(top)).toBe(1_024)
		expect(totals).toEqual(
			counts({
				getters: 21,
				pendingGetters: 21,
				invalidations: 1,
				validations: 21,
			}),
		)
		const names = [
			...Array.from({ length: 10 }, (_, level) => [
				`layer ${level} node 0`,
				`layer ${level} node 1`,
			]).flat(),
			'top',
		]
		expect(countsByName(instrumentation, 'pendingGetters')).toEqual(
			Object.fromEntries(names.map((name) => [name, 1])),
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

	it('counts a mount cleanup returned after the last subscription is dropped', async () => {
		const source = primitiveAtom(0)
		let unsubscribe = () => {}
		const mounted = derivedAtom((read) => read(source), null, {
			name: 'mounted',
			onMount: () => {
				unsubscribe()
				return () => {}
			},
		})
		const store = createStore()
		const instrumentation = countOperations(store)
		unsubscribe = store.subscribe(mounted, () => {})
		await flushMicrotask()
		expect(instrumentation.totals).toEqual(counts({ getters: 1, cleanups: 1 }))
		expect(named(instrumentation)).toEqual({
			mounted: { getters: 1, cleanups: 1 },
		})
	})

	it('counts an effect cleanup returned after the effect is unmounted', async () => {
		const source = primitiveAtom(0)
		let unmount = () => {}
		const effect = effectAtom((read) => {
			read(source)
			unmount()
			return () => {}
		})
		const store = createStore()
		const instrumentation = countOperations(store)
		unmount = store.mountEffect(effect)
		await flushMicrotask()
		expect(instrumentation.totals).toEqual(counts({ effects: 1, cleanups: 1 }))
	})
})
