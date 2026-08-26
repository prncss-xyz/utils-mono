import { describe, expect, it, vi } from 'vitest'

import { RESET } from '../store/functions'
import { derived, primitive, Store } from './store'

const flushMicrotask = () => Promise.resolve()

describe('Store', () => {
	it('defers primitive values, updates, and resets to the next microtask', async () => {
		const count = primitive(0)
		const store = Store.init()

		expect(store.peek(count)).toBe(0)

		store.send(count, 3)
		expect(store.peek(count)).toBe(0)
		await flushMicrotask()
		expect(store.peek(count)).toBe(3)

		store.send(count, (value) => value + 1)
		expect(store.peek(count)).toBe(3)
		await flushMicrotask()
		expect(store.peek(count)).toBe(4)

		store.send(count, RESET)
		expect(store.peek(count)).toBe(4)
		await flushMicrotask()
		expect(store.peek(count)).toBe(0)
	})

	it('applies queued sends FIFO and evaluates updaters at flush time', async () => {
		const count = primitive(1)
		const store = Store.init()
		const updater = vi.fn((value: number) => value * 2)

		store.send(count, 3)
		store.send(count, updater)
		store.send(count, (value) => value + 4)

		expect(store.peek(count)).toBe(1)
		expect(updater).not.toHaveBeenCalled()

		await flushMicrotask()

		expect(updater).toHaveBeenCalledWith(3)
		expect(store.peek(count)).toBe(10)
	})

	it('coalesces notifications per affected primitive instance', async () => {
		const count = primitive(0)
		const label = primitive('before')
		const store = Store.init()
		const countValues: number[] = []
		const countSubscriber = vi.fn(() => countValues.push(store.peek(count)))
		const labelSubscriber = vi.fn()

		store.subscribe(count, countSubscriber)
		store.subscribe(label, labelSubscriber)

		store.send(count, 1)
		store.send(label, 'after')
		store.send(count, (value) => value + 1)

		expect(countSubscriber).not.toHaveBeenCalled()
		expect(labelSubscriber).not.toHaveBeenCalled()

		await flushMicrotask()

		expect(countSubscriber).toHaveBeenCalledOnce()
		expect(countValues).toEqual([2])
		expect(labelSubscriber).toHaveBeenCalledOnce()
	})

	it('keeps RESET lazy and preserves its notification behavior', async () => {
		const getter = vi.fn(() => 1)
		const count = primitive(getter)
		const store = Store.init()
		const subscriber = vi.fn()

		expect(store.peek(count)).toBe(1)
		store.send(count, 5)
		await flushMicrotask()
		store.subscribe(count, subscriber)

		store.send(count, RESET)

		expect(store.peek(count)).toBe(5)
		expect(subscriber).not.toHaveBeenCalled()
		expect(getter).toHaveBeenCalledOnce()

		await flushMicrotask()

		expect(subscriber).toHaveBeenCalledOnce()
		expect(getter).toHaveBeenCalledOnce()
		expect(store.peek(count)).toBe(1)
		expect(getter).toHaveBeenCalledTimes(2)
	})

	it('runs a writable derived setter synchronously and queues its primitive write', async () => {
		const count = primitive(0)
		const setter = vi.fn(
			(read: (symbol: typeof count) => number, write: Store['send'], amount: number) =>
				write(count, read(count) + amount),
		)
		const plus = derived((read) => read(count), setter)
		const store = Store.init()

		store.send(plus, 3)

		expect(setter).toHaveBeenCalledOnce()
		expect(store.peek(count)).toBe(0)

		await flushMicrotask()

		expect(store.peek(count)).toBe(3)
	})

	it('defers a primitive send from a subscriber to a subsequent microtask', async () => {
		const count = primitive(0)
		const store = Store.init()
		const subscriber = vi.fn(() => {
			if (store.peek(count) === 1) store.send(count, 2)
		})

		store.subscribe(count, subscriber)
		store.send(count, 1)

		await flushMicrotask()

		expect(store.peek(count)).toBe(1)
		expect(subscriber).toHaveBeenCalledOnce()

		await flushMicrotask()

		expect(store.peek(count)).toBe(2)
		expect(subscriber).toHaveBeenCalledTimes(2)
	})

	it('invalidates a derived subscriber once after a primitive batch', async () => {
		const count = primitive(0)
		const double = derived(
			(read) => read(count) * 2,
			(read, write, amount: number) => write(count, read(count) + amount),
		)
		const store = Store.init()
		const countSubscriber = vi.fn()
		const doubleSubscriber = vi.fn()

		store.subscribe(count, countSubscriber)
		const unsubscribeDouble = store.subscribe(double, doubleSubscriber)

		expect(store.peek(double)).toBe(0)

		store.send(count, 2)
		store.send(count, (value) => value + 1)

		expect(store.peek(count)).toBe(0)
		expect(store.peek(double)).toBe(0)

		await flushMicrotask()

		expect(store.peek(count)).toBe(3)
		expect(store.peek(double)).toBe(6)
		expect(countSubscriber).toHaveBeenCalledOnce()
		expect(doubleSubscriber).toHaveBeenCalledOnce()

		store.send(double, 3)
		expect(store.peek(count)).toBe(3)

		await flushMicrotask()

		expect(store.peek(count)).toBe(6)
		expect(store.peek(double)).toBe(12)
		expect(countSubscriber).toHaveBeenCalledTimes(2)
		expect(doubleSubscriber).toHaveBeenCalledTimes(2)
		unsubscribeDouble()
	})
})
