import { describe, expect, it, vi } from 'vitest'

import { RESET } from '../store/functions'
import { derived, primitive, Store } from './store'

describe('Store', () => {
	it('reads, sets, updates, and resets a primitive value', () => {
		const count = primitive(0)
		const store = Store.init()

		expect(store.peek(count)).toBe(0)

		store.send(count, 3)
		expect(store.peek(count)).toBe(3)

		store.send(count, (value) => value + 1)
		expect(store.peek(count)).toBe(4)

		store.send(count, RESET)
		expect(store.peek(count)).toBe(0)
	})

	it('reads and writes a derived value and notifies both subscribers', () => {
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

		store.send(double, 3)

		expect(store.peek(count)).toBe(3)
		expect(store.peek(double)).toBe(6)
		expect(countSubscriber).toHaveBeenCalledOnce()
		expect(doubleSubscriber).toHaveBeenCalledOnce()

		store.send(double, 3)

		expect(store.peek(count)).toBe(6)
		expect(store.peek(double)).toBe(12)
		expect(countSubscriber).toHaveBeenCalledTimes(2)
		expect(doubleSubscriber).toHaveBeenCalledTimes(2)
		unsubscribeDouble()
	})
})
