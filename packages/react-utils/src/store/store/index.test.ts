import { describe, expect, it, vi } from 'vitest'

import {
	derivedAtom,
	atomFamily,
	hydrate,
	primitiveAtom,
	type AtomSymbol,
	type Read,
} from '.'
import { countOperations, createStore, flushMicrotask } from './utils.testing'

describe('Store', () => {
	it('hydrates atoms and family members before the store is returned', () => {
		const count = primitiveAtom(0)
		const str = primitiveAtom('')
		const doubled = derivedAtom(
			(read) => read(count) * 2,
			(_read, write, value: number) => write(count, value / 2),
		)
		const members = atomFamily((key: string) => primitiveAtom(key.length), {
			TTL: Infinity,
		})
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const create = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: number) =>
				write(values, 'a', value),
			),
		)
		const commands = atomFamily(create)
		const store = createStore([
			[count, 4],
			[doubled, 12],
			[str, 'a'],
			hydrate(members, 'first', 10),
			[values, 'b', 5],
			[commands, 'a', 7],
		])

		expect(store.peek(count)).toBe(6)
		expect(store.peek(doubled)).toBe(12)
		expect(store.peek(str)).toBe('a')
		expect(store.peek(members, 'first')).toBe(10)
		expect(store.peek(members, 'other')).toBe(5)
		expect(store.peek(values, 'a')).toBe(7)
		expect(store.peek(values, 'b')).toBe(5)
		store.resolve(commands, 'a')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('isolates resolved handles and state per store', async () => {
		const atom = primitiveAtom(0)
		const first = createStore()
		const second = createStore()

		expect(first.resolve(atom)).toBe(first.resolve(atom))
		expect(second.resolve(atom)).not.toBe(first.resolve(atom))

		first.resolve(atom).send(5)
		await flushMicrotask()
		expect(first.resolve(atom).peek()).toBe(5)
		expect(second.resolve(atom).peek()).toBe(0)
		expect(second.peek(atom)).toBe(0)
	})

	it('reads and writes atom families from a derived setter', async () => {
		const sourceFamily = atomFamily((_key: string) => primitiveAtom(3))
		const targetFamily = atomFamily((_key: string) => primitiveAtom(0))
		const selected = derivedAtom(
			(read) => read(targetFamily, 'target'),
			(read, write, multiplier: number) =>
				write(
					targetFamily,
					'target',
					read(sourceFamily, 'source') * multiplier,
				),
		)
		const store = createStore()

		store.send(selected, 2)
		await flushMicrotask()

		expect(store.peek(targetFamily, 'target')).toBe(6)
	})

	it('tracks dependencies on the resolved family member', async () => {
		const numbers = atomFamily((key: string) =>
			primitiveAtom(key === 'first' ? 1 : 10),
		)
		const selected = derivedAtom(
			(read) => read(numbers, 'first'),
			(_read, _write, _event: never) => {},
		)
		const store = createStore()
		const subscriber = vi.fn()

		store.subscribe(selected, subscriber)
		expect(store.peek(selected)).toBe(1)

		store.send(numbers, 'second', 11)
		await flushMicrotask()
		expect(subscriber).not.toHaveBeenCalled()
		expect(store.peek(selected)).toBe(1)

		store.send(numbers, 'first', 2)
		await flushMicrotask()
		expect(subscriber).toHaveBeenCalledOnce()
		expect(store.peek(selected)).toBe(2)
	})

	it('replaces conditional dependencies without notifying from stale sources', async () => {
		const selectFirst = primitiveAtom(true)
		const first = primitiveAtom(1)
		const second = primitiveAtom(10)
		const selected = derivedAtom(
			(read) => (read(selectFirst) ? read(first) : read(second)),
			() => {},
		)
		const store = createStore()
		const subscriber = vi.fn(() => store.peek(selected))
		store.subscribe(selected, subscriber)
		expect(store.peek(selected)).toBe(1)

		store.send(selectFirst, false)
		await flushMicrotask()
		expect(subscriber).toHaveLastReturnedWith(10)
		subscriber.mockClear()

		store.send(first, 2)
		await flushMicrotask()
		expect(subscriber).not.toHaveBeenCalled()

		store.send(second, 11)
		await flushMicrotask()
		expect(subscriber).toHaveBeenCalledOnce()
		expect(subscriber).toHaveLastReturnedWith(11)
	})

	it('validates each instance of a layered diamond at most once per change', async () => {
		const leaf = primitiveAtom(1)
		const depth = 20
		const width = 2
		const evaluate = vi.fn()
		let layer: AtomSymbol<number, never>[] = [leaf as AtomSymbol<number, never>]
		for (let level = 0; level < depth; level++) {
			const previous = layer
			layer = Array.from({ length: width }, () =>
				derivedAtom((read) => {
					evaluate()
					return previous.reduce((sum, atom) => sum + read(atom), 0)
				}),
			)
		}
		const top = derivedAtom((read) =>
			layer.reduce((sum, atom) => sum + read(atom), 0),
		)
		const store = createStore()
		const { totals } = countOperations(store)
		const initial = store.peek(top)
		const derivedCount = depth * width
		expect(evaluate).toHaveBeenCalledTimes(derivedCount)
		const validations = totals.validations
		expect(store.peek(top)).toBe(initial)
		expect(store.peek(top)).toBe(initial)
		expect(totals.validations).toBe(validations)
		expect(evaluate).toHaveBeenCalledTimes(derivedCount)
		store.send(leaf, 2)
		await flushMicrotask()
		expect(store.peek(top)).toBe(2 * initial)
		expect(evaluate).toHaveBeenCalledTimes(2 * derivedCount)
		expect(totals.validations - validations).toBeLessThanOrEqual(
			derivedCount + 1,
		)
	})

	it('shows public reads and getters committed values while setters compose against pending writes', async () => {
		const count = primitiveAtom(0)
		const increment = derivedAtom(null, (read, write) =>
			write(count, read(count) + 1),
		)
		const doubled = derivedAtom((read) => read(count) * 2)
		const store = createStore()
		const seen: number[] = []
		store.subscribe(count, () => {
			seen.push(store.peek(count))
			if (store.peek(count) === 2) store.send(count, 10)
		})
		await flushMicrotask()
		store.send(count, 1)
		expect(store.peek(count)).toBe(0)
		store.send(increment)
		expect(store.peek(count)).toBe(0)
		expect(store.peek(doubled)).toBe(0)
		await flushMicrotask()
		expect(store.peek(count)).toBe(2)
		expect(seen).toEqual([2])
		await flushMicrotask()
		expect(store.peek(count)).toBe(10)
		expect(seen).toEqual([2, 10])
	})

	it('keeps a promise a plain value and ignores a read made after an await while it stays subscribed', async () => {
		const first = primitiveAtom(1)
		const second = primitiveAtom(10)
		const getter = vi.fn((read: Read) => {
			const head = read(first)
			return Promise.resolve().then(() => head + read(second))
		})
		const sum = derivedAtom(getter)
		const store = createStore()
		const notify = vi.fn()
		store.subscribe(sum, notify)
		await flushMicrotask()
		const initial = store.peek(sum)
		expect(initial).toBeInstanceOf(Promise)
		expect(await initial).toBe(11)
		store.send(second, 20)
		await flushMicrotask()
		expect(getter).toHaveBeenCalledOnce()
		expect(notify).not.toHaveBeenCalled()
		expect(store.peek(sum)).toBe(initial)
		store.send(first, 2)
		await flushMicrotask()
		expect(getter).toHaveBeenCalledTimes(2)
		expect(store.peek(sum)).not.toBe(initial)
		expect(await store.peek(sum)).toBe(22)
	})
})
