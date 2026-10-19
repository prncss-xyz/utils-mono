import { describe, expect, it, vi } from 'vitest'

import { RESET } from '../functions'
import {
	createStore,
	derived,
	family,
	hydrate,
	primitive,
	TRANSIENT,
} from './store'

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
		expect(store.peek(str)).toBe('a')
	})

	it('hydrates atom family members before the store is returned', () => {
		const members = family((key: string) => primitive(key.length))
		const store = createStore([[members, 'first', 10]])

		expect(store.peek(members, 'first')).toBe(10)
		expect(store.peek(members, 'second')).toBe(6)
	})

	it('creates reusable, typed hydration entries', () => {
		const count = primitive(0)
		const members = family((key: string) => primitive(key.length))
		const hydration = [hydrate(count, 4), hydrate(members, 'first', 10)]
		const store = createStore(hydration)

		expect(store.peek(count)).toBe(4)
		expect(store.peek(members, 'first')).toBe(10)
	})

	it('type-checks hydration against atom events and family keys', () => {
		const count = primitive(0)
		const members = family((key: string) => primitive(key.length))

		const checkTypes = () => {
			// @ts-expect-error count events must correspond to its number state
			createStore([[count, 'invalid']])
			// @ts-expect-error family keys must correspond to the family key type
			createStore([[members, 123, 10]])
			// @ts-expect-error family events must correspond to the member event type
			createStore([[members, 'first', 'invalid']])
			// @ts-expect-error reusable atom hydration entries validate their event
			hydrate(count, 'invalid')
			// @ts-expect-error reusable family hydration entries validate their key
			hydrate(members, 123, 10)
			// @ts-expect-error reusable family hydration entries validate their event
			hydrate(members, 'first', 'invalid')
		}

		expect(checkTypes).toBeTypeOf('function')
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

	it('applies queued sends after flushing', async () => {
		const count = primitive(1)
		const store = createStore()

		store.send(count, (value) => value + 2)
		store.send(count, (value) => value + 4)

		expect(store.peek(count)).toBe(1)

		await flushMicrotask()

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

	it('commits RESET and notifies after flushing', async () => {
		const count = primitive(() => 1)
		const store = createStore()
		const subscriber = vi.fn()

		expect(store.peek(count)).toBe(1)
		store.send(count, 5)
		await flushMicrotask()
		store.subscribe(count, subscriber)

		store.send(count, RESET)

		expect(store.peek(count)).toBe(5)
		expect(subscriber).not.toHaveBeenCalled()

		await flushMicrotask()

		expect(subscriber).toHaveBeenCalledOnce()
		expect(store.peek(count)).toBe(1)
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

	it('notifies once when repeated reads are recomputed inside a subscriber', async () => {
		const source = primitive(1)
		const doubled = derived(
			(read) => read(source) + read(source),
			() => {},
		)
		const store = createStore()
		const subscriber = vi.fn(() => store.peek(doubled))
		store.subscribe(doubled, subscriber)
		expect(store.peek(doubled)).toBe(2)

		store.send(source, 2)
		await flushMicrotask()
		expect(subscriber).toHaveBeenCalledOnce()
		expect(subscriber).toHaveLastReturnedWith(4)

		store.send(source, 3)
		await flushMicrotask()
		expect(subscriber).toHaveBeenCalledTimes(2)
		expect(subscriber).toHaveLastReturnedWith(6)
	})

	it('replaces conditional dependencies without notifying from stale sources', async () => {
		const selectFirst = primitive(true)
		const first = primitive(1)
		const second = primitive(10)
		const selected = derived(
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
		expect(doer).toHaveBeenLastCalledWith(
			1,
			undefined,
			expect.any(Function),
			expect.any(Function),
		)
	})

	it('defers sends from an effect until a later microtask', async () => {
		const count = primitive(0, (next, _last, _get, set) => {
			if (next === 0) set(count, 1)
		})
		const store = createStore()

		store.subscribe(count, () => {})
		await flushMicrotask()

		expect(store.peek(count)).toBe(0)
		await flushMicrotask()

		expect(store.peek(count)).toBe(1)
	})

	it('reads atoms and families in effects without tracking dependencies', async () => {
		const source = primitive(1)
		const values = family((key: string) => primitive(key.length))
		const observed = derived(
			(read) => read(source) * 2,
			() => {},
		)
		const runs = vi.fn()
		const trigger = primitive(0, (next, _last, get) => {
			runs(next, get(source), get(observed), get(values, 'key'))
		})
		const store = createStore()

		store.subscribe(trigger, () => {})
		await flushMicrotask()
		expect(runs).toHaveBeenLastCalledWith(0, 1, 2, 3)

		store.send(source, 2)
		store.send(values, 'key', 4)
		await flushMicrotask()
		expect(runs).toHaveBeenCalledOnce()

		store.send(trigger, 1)
		await flushMicrotask()
		expect(runs).toHaveBeenLastCalledWith(1, 2, 4, 4)
	})

	it('writes other atoms, derived atoms, and families from effects', async () => {
		const target = primitive(0)
		const doubled = derived(
			(read) => read(target) * 2,
			(_read, write, value: number) => write(target, value / 2),
		)
		const values = family((_key: string) => primitive(0))
		const trigger = primitive(0, (next, _last, _get, set) => {
			if (next === undefined) return
			set(target, 1)
			set(doubled, 6)
			set(values, 'key', (value) => value + 1)
		})
		const store = createStore()

		store.subscribe(trigger, () => {})
		await flushMicrotask()
		expect(store.peek(target)).toBe(0)
		expect(store.peek(values, 'key')).toBe(0)
		await flushMicrotask()
		expect(store.peek(doubled)).toBe(6)
		expect(store.peek(values, 'key')).toBe(1)
	})

	it('coalesces mounting and dependency changes into one effect run', async () => {
		const doer = vi.fn()
		const count = primitive(0, doer)
		const store = createStore()

		store.subscribe(count, () => {})
		store.send(count, 1)
		await flushMicrotask()

		expect(doer).toHaveBeenCalledOnce()
		expect(doer).toHaveBeenLastCalledWith(
			1,
			undefined,
			expect.any(Function),
			expect.any(Function),
		)
	})

	it('transitions effects on unmount and delays its cleanup until remount', async () => {
		const cleanup = vi.fn()
		const doer = vi.fn(() => cleanup)
		const count = primitive(0, doer)
		const store = createStore()
		const unsubscribe = store.subscribe(count, () => {})

		await flushMicrotask()
		unsubscribe()

		expect(doer).toHaveBeenLastCalledWith(
			undefined,
			0,
			expect.any(Function),
			expect.any(Function),
		)
		expect(cleanup).toHaveBeenCalledOnce()

		store.send(count, 1)
		await flushMicrotask()

		expect(doer).toHaveBeenCalledTimes(2)
		expect(cleanup).toHaveBeenCalledOnce()

		store.subscribe(count, () => {})
		await flushMicrotask()

		expect(cleanup).toHaveBeenCalledTimes(2)
		expect(doer).toHaveBeenLastCalledWith(
			1,
			undefined,
			expect.any(Function),
			expect.any(Function),
		)
	})

	it('does not mount dependants just because their dependency is subscribed', async () => {
		const count = primitive(1)
		const effect = vi.fn()
		const double = derived(
			(read) => read(count) * 2,
			() => {},
			effect,
		)
		const store = createStore()
		store.peek(double)
		const unsubscribe = store.subscribe(count, () => {})
		await flushMicrotask()
		expect(effect).not.toHaveBeenCalled()
		unsubscribe()
		expect(effect).not.toHaveBeenCalled()
	})

	it('mounts dependencies first and unmounts dependants first across a diamond', async () => {
		const events: string[] = []
		const effect = (name: string) => (next: number | undefined) => {
			events.push(`${name}:${next === undefined ? 'unmount' : 'mount'}`)
			return () => {
				events.push(`${name}:cleanup`)
			}
		}
		const source = primitive(1, effect('source'))
		const left = derived<number, never>(
			(read) => read(source),
			() => {},
			effect('left'),
		)
		const right = derived<number, never>(
			(read) => read(source),
			() => {},
			effect('right'),
		)
		const leaf = derived<number, never>(
			(read) => read(left) + read(right),
			() => {},
			effect('leaf'),
		)
		const store = createStore()
		const unsubscribe = store.subscribe(leaf, () => {})
		await flushMicrotask()
		expect(events).toEqual([
			'source:mount',
			'left:mount',
			'right:mount',
			'leaf:mount',
		])
		events.length = 0
		unsubscribe()
		expect(events).toEqual([
			'leaf:cleanup',
			'leaf:unmount',
			'left:cleanup',
			'left:unmount',
			'right:cleanup',
			'right:unmount',
			'source:cleanup',
			'source:unmount',
		])
	})

	it('keeps shared dependencies mounted until their last consumer releases them', async () => {
		const effect = vi.fn()
		const source = primitive(1, effect)
		const left = derived(
			(read) => read(source),
			() => {},
		)
		const right = derived(
			(read) => read(source),
			() => {},
		)
		const store = createStore()
		const unsubscribeSource = store.subscribe(source, () => {})
		const unsubscribeLeft = store.subscribe(left, () => {})
		const unsubscribeRight = store.subscribe(right, () => {})
		await flushMicrotask()
		unsubscribeLeft()
		unsubscribeSource()
		expect(effect).toHaveBeenCalledOnce()
		unsubscribeRight()
		expect(effect).toHaveBeenCalledTimes(2)
		expect(effect.mock.calls[1]?.[0]).toBeUndefined()
	})

	it('mounts new conditional dependencies and releases old ones', async () => {
		const firstEffect = vi.fn()
		const secondEffect = vi.fn()
		const first = primitive(1, firstEffect)
		const second = primitive(2, secondEffect)
		const selectFirst = primitive(true)
		const selected = derived(
			(read) => (read(selectFirst) ? read(first) : read(second)),
			() => {},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(selected, () => {})
		await flushMicrotask()
		expect(firstEffect).toHaveBeenCalledOnce()
		expect(secondEffect).not.toHaveBeenCalled()
		store.send(selectFirst, false)
		await flushMicrotask()
		store.peek(selected)
		await flushMicrotask()
		expect(firstEffect).toHaveBeenCalledTimes(2)
		expect(firstEffect.mock.calls[1]?.[0]).toBeUndefined()
		expect(secondEffect).toHaveBeenCalledOnce()
		unsubscribe()
		expect(secondEffect).toHaveBeenCalledTimes(2)
	})

	it('does not release references twice or release a later subscription', async () => {
		const effect = vi.fn()
		const atom = primitive(1, effect)
		const store = createStore()
		const notify = vi.fn()
		const unsubscribe = store.subscribe(atom, notify)
		await flushMicrotask()
		unsubscribe()
		expect(effect).toHaveBeenCalledTimes(2)

		const unsubscribeAgain = store.subscribe(atom, notify)
		await flushMicrotask()
		unsubscribe()
		store.send(atom, 2)
		await flushMicrotask()
		expect(notify).toHaveBeenCalledOnce()
		expect(effect).toHaveBeenCalledTimes(4)
		unsubscribeAgain()
		unsubscribeAgain()
		expect(effect).toHaveBeenCalledTimes(5)
	})

	it('does not acquire extra references for repeated or retained dependency reads', async () => {
		const sourceEffect = vi.fn()
		const source = primitive(1, sourceEffect)
		const trigger = primitive(0)
		const selected = derived(
			(read) => read(trigger) + read(source) + read(source),
			() => {},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(selected, () => {
			store.peek(selected)
		})
		await flushMicrotask()
		for (let value = 1; value <= 3; value++) {
			store.send(trigger, value)
			await flushMicrotask()
		}
		expect(sourceEffect).toHaveBeenCalledOnce()
		unsubscribe()
		expect(sourceEffect).toHaveBeenCalledTimes(2)
	})

	it('keeps dependency ownership balanced when cleanup remounts a consumer', async () => {
		const sourceEffect = vi.fn()
		const source = primitive(1, sourceEffect)
		let remount = () => {}
		const consumer = derived<number, never>(
			(read) => read(source),
			() => {},
			(next) => {
				if (next === undefined) remount()
			},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(consumer, () => {})
		let unsubscribeAgain = () => {}
		remount = () => {
			remount = () => {}
			unsubscribeAgain = store.subscribe(consumer, () => {})
		}
		await flushMicrotask()
		unsubscribe()
		await flushMicrotask()
		expect(sourceEffect).toHaveBeenCalledOnce()
		unsubscribeAgain()
		expect(sourceEffect).toHaveBeenCalledTimes(2)
	})

	it('releases dependency references after several conditional switches', async () => {
		const firstEffect = vi.fn()
		const secondEffect = vi.fn()
		const first = primitive(1, firstEffect)
		const second = primitive(2, secondEffect)
		const selectFirst = primitive(true)
		const selected = derived(
			(read) => (read(selectFirst) ? read(first) : read(second)),
			() => {},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(selected, () => {
			store.peek(selected)
		})
		await flushMicrotask()
		for (const choice of [false, true, false, true]) {
			store.send(selectFirst, choice)
			await flushMicrotask()
		}
		unsubscribe()
		expect(firstEffect.mock.calls.map(([next]) => next)).toEqual([
			1,
			undefined,
			1,
			undefined,
			1,
			undefined,
		])
		expect(secondEffect.mock.calls.map(([next]) => next)).toEqual([
			2,
			undefined,
			2,
			undefined,
		])
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

	it('reuses one resolved transient family member for all operations', async () => {
		const create = vi.fn((key: string) => primitive(key))
		const names = family(create, { TTL: TRANSIENT })
		const store = createStore()
		const member = store.resolve(names, 'first')
		const subscriber = vi.fn()

		const unsubscribe = member.subscribe(subscriber)
		member.send('updated')
		await flushMicrotask()

		expect(member.peek()).toBe('updated')
		expect(subscriber).toHaveBeenCalledOnce()
		expect(create).toHaveBeenCalledOnce()
		unsubscribe()
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

	it('cleans dependants first and reruns dependencies first after a batched value change', async () => {
		const events: string[] = []
		const effect =
			(name: string) =>
			(next: number | undefined, last: number | undefined) => {
				events.push(`run:${name}:${last}->${next}`)
				return () => {
					events.push(`cleanup:${name}:${next}`)
				}
			}
		const source = primitive(0, effect('source'))
		const left = derived<number, never>(
			(read) => read(source) + 1,
			() => {},
			effect('left'),
		)
		const right = derived<number, never>(
			(read) => read(source) + 2,
			() => {},
			effect('right'),
		)
		const leaf = derived<number, never>(
			(read) => read(left) + read(right),
			() => {},
			effect('leaf'),
		)
		const store = createStore()
		store.subscribe(leaf, () => {})
		await flushMicrotask()
		events.length = 0

		store.send(source, 1)
		store.send(source, 2)
		await flushMicrotask()

		expect(events).toEqual([
			'cleanup:leaf:3',
			'cleanup:right:2',
			'cleanup:left:1',
			'cleanup:source:0',
			'run:source:0->2',
			'run:left:1->3',
			'run:right:2->4',
			'run:leaf:3->7',
		])
	})

	it('leaves unchanged effects and their cleanups intact during updates', async () => {
		const events: string[] = []
		const source = primitive(0, (next) => {
			events.push(`run:source:${next}`)
			return () => {
				events.push(`cleanup:source:${next}`)
			}
		})
		const parity = derived<number, never>(
			(read) => read(source) % 2,
			() => {},
			(next) => {
				events.push(`run:parity:${next}`)
				return () => {
					events.push(`cleanup:parity:${next}`)
				}
			},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(parity, () => {})
		await flushMicrotask()
		events.length = 0
		store.send(source, 2)
		await flushMicrotask()
		expect(events).toEqual(['cleanup:source:0', 'run:source:2'])
		events.length = 0
		unsubscribe()
		expect(events).toEqual([
			'cleanup:parity:0',
			'run:parity:undefined',
			'cleanup:source:2',
			'run:source:undefined',
		])
	})

	it('does not repeat cleanup or rerun effects when cleanup unsubscribes the consumer', async () => {
		const events: string[] = []
		let unsubscribe = () => {}
		const source = primitive(0, (next) => {
			events.push(`run:source:${next}`)
			return () => {
				events.push(`cleanup:source:${next}`)
			}
		})
		const consumer = derived<number, never>(
			(read) => read(source),
			() => {},
			(next) => {
				events.push(`run:consumer:${next}`)
				return () => {
					events.push(`cleanup:consumer:${next}`)
					unsubscribe()
				}
			},
		)
		const store = createStore()
		unsubscribe = store.subscribe(consumer, () => {})
		await flushMicrotask()
		events.length = 0
		store.send(source, 1)
		await flushMicrotask()
		expect(events).toEqual([
			'cleanup:consumer:0',
			'run:consumer:undefined',
			'cleanup:source:0',
			'run:source:undefined',
		])
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
