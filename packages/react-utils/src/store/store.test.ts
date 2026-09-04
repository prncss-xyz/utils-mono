import { describe, expect, it, vi } from 'vitest'

import { RESET } from '../functions'
import { createStore, derived, family, primitive, TRANSIENT } from './store'

const flushMicrotask = () => Promise.resolve()

describe('Store', () => {
	it('hydrates atoms before the store is returned', () => {
		const count = primitive(0)
		const str = primitive('')
		const doubled = derived(
			(read) => read(count) * 2,
			(_read, write, value: number) => write(count, value / 2),
		)
		const store = createStore([
			[count, 4],
			[doubled, 12],
			[str, 'a'],
		])

		expect(store.peek(count)).toBe(6)
		expect(store.peek(doubled)).toBe(12)
	})

	it('hydrates atom family members before the store is returned', () => {
		const members = family((key: string) => primitive(key.length))
		const store = createStore([[members, 'first', 10]])

		expect(store.peek(members, 'first')).toBe(10)
		expect(store.peek(members, 'second')).toBe(6)
	})

	it('defers primitive values, updates, and resets to the next microtask', async () => {
		const count = primitive(0)
		const store = createStore()

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

	it('applies queued sends and evaluates updaters at flush time', async () => {
		const count = primitive(1)
		const store = createStore()
		const updater = vi.fn((value: number) => value + 2)

		store.send(count, updater)
		store.send(count, (value) => value + 4)

		expect(store.peek(count)).toBe(1)
		expect(updater).not.toHaveBeenCalled()

		await flushMicrotask()

		expect(updater).toHaveBeenCalledOnce()
		expect(store.peek(count)).toBe(7)
	})

	it('coalesces notifications per affected primitive instance', async () => {
		const count = primitive(0)
		const label = primitive('before')
		const store = createStore()
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
		const store = createStore()
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

	it('preserves RESET semantics when composed with updater callbacks', async () => {
		const count = primitive(1)
		const store = createStore()

		store.send(count, 5)
		await flushMicrotask()

		store.send(count, RESET)
		store.send(count, (value) => value + 1)
		await flushMicrotask()

		expect(store.peek(count)).toBe(2)
	})

	it('runs a writable derived setter synchronously and queues its primitive write', async () => {
		const count = primitive(0)
		const setter = vi.fn(
			(read: (symbol: typeof count) => number, write: any, amount: number) =>
				write(count, read(count) + amount),
		)
		const plus = derived((read) => read(count), setter)
		const store = createStore()

		store.send(plus, 3)

		expect(setter).toHaveBeenCalledOnce()
		expect(store.peek(count)).toBe(0)

		await flushMicrotask()

		expect(store.peek(count)).toBe(3)
	})

	it('reads a one-argument atom family from a derived getter', () => {
		const members = new Map<string, ReturnType<typeof primitive<string>>>()
		const names = family((key: string) => {
			const member = members.get(key) ?? primitive(key.toUpperCase())
			members.set(key, member)
			return member
		})
		const selected = derived(
			(read) => read(names, 'first'),
			(_read, _write, _event: never) => {},
		)
		const store = createStore()

		expect(store.peek(selected)).toBe('FIRST')
	})

	it('reads and writes atom families from a derived setter', async () => {
		const source = primitive(3)
		const target = primitive(0)
		const sourceFamily = family((_key: string) => source)
		const targetFamily = family((_key: string) => target)
		const selected = derived(
			(read) => read(target),
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

		expect(store.peek(target)).toBe(6)
	})

	it('keeps zero-argument derived reads unchanged', () => {
		const count = primitive(2)
		const double = derived(
			(read) => read(count) * 2,
			(_read, _write, _event: never) => {},
		)
		const store = createStore()

		expect(store.peek(double)).toBe(4)
	})

	it('tracks dependencies on the resolved family member', async () => {
		const first = primitive(1)
		const second = primitive(10)
		const numbers = family((key: string) => (key === 'first' ? first : second))
		const selected = derived(
			(read) => read(numbers, 'first'),
			(_read, _write, _event: never) => {},
		)
		const store = createStore()
		const subscriber = vi.fn()

		store.subscribe(selected, subscriber)
		expect(store.peek(selected)).toBe(1)

		store.send(second, 11)
		await flushMicrotask()
		expect(subscriber).not.toHaveBeenCalled()
		expect(store.peek(selected)).toBe(1)

		store.send(first, 2)
		await flushMicrotask()
		expect(subscriber).toHaveBeenCalledOnce()
		expect(store.peek(selected)).toBe(2)
	})

	it('defers a primitive send from a subscriber to a subsequent microtask', async () => {
		const count = primitive(0)
		const store = createStore()
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
		const store = createStore()
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

	it('skips notifying subscribers when a batch produces no committed change', async () => {
		const count = primitive(0)
		const store = createStore()
		const subscriber = vi.fn()

		store.subscribe(count, subscriber)
		store.send(count, 0)
		await flushMicrotask()

		expect(subscriber).not.toHaveBeenCalled()

		store.send(count, (value) => value)
		await flushMicrotask()

		expect(subscriber).not.toHaveBeenCalled()
	})

	it('runs an effect without requiring separate dependency subscribers', async () => {
		const doer = vi.fn()
		const count = primitive(1, doer)
		const store = createStore()

		store.subscribe(count, () => {})
		await flushMicrotask()

		expect(doer).toHaveBeenCalledOnce()
		expect(doer).toHaveBeenLastCalledWith(1, undefined, expect.any(Function))
	})

	it('defers sends from an effect until a later microtask', async () => {
		const count = primitive(0, (next, _last, send) => {
			if (next === 0) send(1)
		})
		const store = createStore()

		store.subscribe(count, () => {})
		await flushMicrotask()

		expect(store.peek(count)).toBe(0)
		await flushMicrotask()

		expect(store.peek(count)).toBe(1)
	})

	it('coalesces mounting and dependency changes into one effect run', async () => {
		const doer = vi.fn()
		const count = primitive(0, doer)
		const store = createStore()

		store.subscribe(count, () => {})
		store.send(count, 1)
		await flushMicrotask()

		expect(doer).toHaveBeenCalledOnce()
		expect(doer).toHaveBeenLastCalledWith(1, undefined, expect.any(Function))
	})

	it('transitions effects on unmount and delays its cleanup until remount', async () => {
		const cleanup = vi.fn()
		const doer = vi.fn(() => cleanup)
		const count = primitive(0, doer)
		const store = createStore()
		const unsubscribe = store.subscribe(count, () => {})

		await flushMicrotask()
		unsubscribe()

		expect(doer).toHaveBeenLastCalledWith(undefined, 0, expect.any(Function))
		expect(cleanup).toHaveBeenCalledOnce()

		store.send(count, 1)
		await flushMicrotask()

		expect(doer).toHaveBeenCalledTimes(2)
		expect(cleanup).toHaveBeenCalledOnce()

		store.subscribe(count, () => {})
		await flushMicrotask()

		expect(cleanup).toHaveBeenCalledTimes(2)
		expect(doer).toHaveBeenLastCalledWith(1, undefined, expect.any(Function))
	})

	it('mounts a derived atom when one of its dependencies is mounted', async () => {
		const count = primitive(1)
		const doer = vi.fn()
		const double = derived(
			(read) => read(count) * 2,
			(_read, _write, _event: never) => {},
			doer,
		)
		const store = createStore()

		expect(store.peek(double)).toBe(2)
		const unsubscribe = store.subscribe(count, () => {})
		await flushMicrotask()

		expect(doer).toHaveBeenCalledOnce()
		expect(doer).toHaveBeenLastCalledWith(2, undefined, expect.any(Function))

		unsubscribe()
		expect(doer).toHaveBeenLastCalledWith(undefined, 2, expect.any(Function))
	})

	it('subscribes to an atom family member', () => {
		const names = family((key: string) => primitive(key))
		const store = createStore()

		const unsubscribe = store.subscribe(names, 'first', () => {})

		expect(unsubscribe).toBeTypeOf('function')
		unsubscribe()
	})

	it('uses the family hash to identify members', () => {
		const create = vi.fn((key: { id: string }) => primitive(key.id))
		const names = family(create, { hash: (key) => key.id })
		const store = createStore()

		expect(store.peek(names, { id: 'first' })).toBe('first')
		expect(store.peek(names, { id: 'first' })).toBe('first')
		expect(create).toHaveBeenCalledOnce()
	})

	it('does not cache atom family members when TTL is negative', () => {
		const create = vi.fn((key: string) => primitive(key))
		const names = family(create, { TTL: TRANSIENT })
		const store = createStore()

		expect(store.peek(names, 'first')).toBe('first')
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('removes an unmounted atom family member in the next microtask', async () => {
		const create = vi.fn((key: string) => primitive(key))
		const names = family(create)
		const store = createStore()
		const unsubscribe = store.subscribe(names, 'first', () => {})

		unsubscribe()
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledOnce()

		await flushMicrotask()
		store.peek(names, 'first')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('keeps an atom family member that remounts before the next microtask', async () => {
		const create = vi.fn((key: string) => primitive(key))
		const names = family(create)
		const store = createStore()
		const unsubscribe = store.subscribe(names, 'first', () => {})

		unsubscribe()
		const unsubscribeAgain = store.subscribe(names, 'first', () => {})
		await flushMicrotask()
		store.peek(names, 'first')

		expect(create).toHaveBeenCalledOnce()
		unsubscribeAgain()
	})

	it('keeps an unmounted atom family member when TTL is Infinity', async () => {
		const create = vi.fn((key: string) => primitive(key))
		const names = family(create, { TTL: Infinity })
		const store = createStore()
		const unsubscribe = store.subscribe(names, 'first', () => {})

		unsubscribe()
		await flushMicrotask()
		store.peek(names, 'first')

		expect(create).toHaveBeenCalledOnce()
	})

	it('removes an unmounted atom family member after its positive TTL', async () => {
		vi.useFakeTimers()
		const create = vi.fn((key: string) => primitive(key))
		const names = family(create, { TTL: 100 })
		const store = createStore()
		const unsubscribe = store.subscribe(names, 'first', () => {})

		unsubscribe()
		await flushMicrotask()
		vi.advanceTimersByTime(99)
		store.peek(names, 'first')
		expect(create).toHaveBeenCalledOnce()

		vi.advanceTimersByTime(1)
		store.peek(names, 'first')
		expect(create).toHaveBeenCalledTimes(2)
		vi.useRealTimers()
	})

	it('cancels positive TTL removal when the member remounts', async () => {
		vi.useFakeTimers()
		const create = vi.fn((key: string) => primitive(key))
		const names = family(create, { TTL: 100 })
		const store = createStore()
		const unsubscribe = store.subscribe(names, 'first', () => {})

		unsubscribe()
		await flushMicrotask()
		vi.advanceTimersByTime(50)
		const unsubscribeAgain = store.subscribe(names, 'first', () => {})
		vi.advanceTimersByTime(100)
		store.peek(names, 'first')

		expect(create).toHaveBeenCalledOnce()
		unsubscribeAgain()
		vi.useRealTimers()
	})

	it('runs the previous cleanup before rerunning an effect', async () => {
		const events: string[] = []
		const count = primitive(0, (next) => {
			events.push(`run:${next}`)
			return () => events.push(`cleanup:${next}`)
		})
		const store = createStore()

		store.subscribe(count, () => {})
		await flushMicrotask()
		store.send(count, 1)
		await flushMicrotask()

		expect(events).toEqual(['run:0', 'cleanup:0', 'run:1'])
	})
})
