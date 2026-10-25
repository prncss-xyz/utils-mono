import { describe, expect, it, vi } from 'vitest'

import { RESET, type SetStateWithReset } from '../functions'
import {
	createStore,
	derivedAtom,
	atomFamily,
	hydrate,
	primitiveAtom,
	commandAtom,
	TRANSIENT,
} from './store'

const flushMicrotask = () => Promise.resolve()

describe('Store', () => {
	it('hydrates atoms before the store is returned', () => {
		const count = primitiveAtom(0)
		const str = primitiveAtom('')
		const doubled = derivedAtom(
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
		const members = atomFamily((key: string) => primitiveAtom(key.length))
		const store = createStore([[members, 'first', 10]])

		expect(store.peek(members, 'first')).toBe(10)
		expect(store.peek(members, 'second')).toBe(6)
	})

	it('creates reusable, typed hydration entries', () => {
		const count = primitiveAtom(0)
		const members = atomFamily((key: string) => primitiveAtom(key.length))
		const hydration = [hydrate(count, 4), hydrate(members, 'first', 10)]
		const store = createStore(hydration)

		expect(store.peek(count)).toBe(4)
		expect(store.peek(members, 'first')).toBe(10)
	})

	it('type-checks hydration against atom events and family keys', () => {
		const count = primitiveAtom(0)
		const members = atomFamily((key: string) => primitiveAtom(key.length))

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
		const count = primitiveAtom(0)
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
		const count = primitiveAtom(1)
		const store = createStore()

		store.send(count, (value) => value + 2)
		store.send(count, (value) => value + 4)

		expect(store.peek(count)).toBe(1)

		await flushMicrotask()

		expect(store.peek(count)).toBe(7)
	})

	it('coalesces notifications per affected primitive instance', async () => {
		const count = primitiveAtom(0)
		const label = primitiveAtom('before')
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
		const count = primitiveAtom(() => 1)
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
		const count = primitiveAtom(1)
		const store = createStore()

		store.send(count, 5)
		await flushMicrotask()

		store.send(count, RESET)
		store.send(count, (value) => value + 1)
		await flushMicrotask()

		expect(store.peek(count)).toBe(2)
	})

	it('runs a writable derived setter synchronously and queues its primitive write', async () => {
		const count = primitiveAtom(0)
		const setter = vi.fn(
			(read: (symbol: typeof count) => number, write: any, amount: number) =>
				write(count, read(count) + amount),
		)
		const plus = derivedAtom((read) => read(count), setter)
		const store = createStore()

		store.send(plus, 3)

		expect(setter).toHaveBeenCalledOnce()
		expect(store.peek(count)).toBe(0)

		await flushMicrotask()

		expect(store.peek(count)).toBe(3)
	})

	it('composes derived writes against pending values through nested getters', async () => {
		const count = primitiveAtom(10)
		const doubled = derivedAtom((read) => read(count) * 2)
		const members = atomFamily((_key: string) => doubled)
		const update = derivedAtom(null, (read, write, amount: number) =>
			write(count, read(members, 'count') / 2 + amount),
		)
		const store = createStore()
		const subscriber = vi.fn()
		store.subscribe(doubled, subscriber)
		expect(store.peek(doubled)).toBe(20)

		store.send(count, 0)
		store.send(update, 2)
		store.send(update, 3)
		expect(store.peek(count)).toBe(10)
		expect(store.peek(doubled)).toBe(20)
		expect(subscriber).not.toHaveBeenCalled()

		await flushMicrotask()
		expect(store.peek(count)).toBe(5)
		expect(store.peek(doubled)).toBe(10)
		expect(subscriber).toHaveBeenCalledOnce()
	})

	it('lets primitive value writes replace earlier pending derived writes', async () => {
		const count = primitiveAtom(1)
		const increment = derivedAtom(null, (read, write) =>
			write(count, read(count) + 1),
		)
		const store = createStore()
		store.send(increment)
		store.send(count, 10)
		store.send(increment)
		await flushMicrotask()
		expect(store.peek(count)).toBe(11)
	})

	it('reads a one-argument atom family from a derived getter', () => {
		const members = new Map<string, ReturnType<typeof primitiveAtom<string>>>()
		const names = atomFamily((key: string) => {
			const member = members.get(key) ?? primitiveAtom(key.toUpperCase())
			members.set(key, member)
			return member
		})
		const selected = derivedAtom(
			(read) => read(names, 'first'),
			(_read, _write, _event: never) => {},
		)
		const store = createStore()

		expect(store.peek(selected)).toBe('FIRST')
	})

	it('reads and writes atom families from a derived setter', async () => {
		const source = primitiveAtom(3)
		const target = primitiveAtom(0)
		const sourceFamily = atomFamily((_key: string) => source)
		const targetFamily = atomFamily((_key: string) => target)
		const selected = derivedAtom(
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
		const count = primitiveAtom(2)
		const double = derivedAtom(
			(read) => read(count) * 2,
			(_read, _write, _event: never) => {},
		)
		const store = createStore()

		expect(store.peek(double)).toBe(4)
	})

	it('tracks dependencies on the resolved family member', async () => {
		const first = primitiveAtom(1)
		const second = primitiveAtom(10)
		const numbers = atomFamily((key: string) =>
			key === 'first' ? first : second,
		)
		const selected = derivedAtom(
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
		const source = primitiveAtom(1)
		const doubled = derivedAtom(
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

	it('defers a primitive send from a subscriber to a subsequent microtask', async () => {
		const count = primitiveAtom(0)
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
		const count = primitiveAtom(0)
		const double = derivedAtom(
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
		const count = primitiveAtom(0)
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
		const count = primitiveAtom(1, { effect: doer })
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
		const count = primitiveAtom(0, {
			effect: (next, _last, _get, set) => {
				if (next === 0) set(count, 1)
			},
		})
		const store = createStore()

		store.subscribe(count, () => {})
		await flushMicrotask()

		expect(store.peek(count)).toBe(0)
		await flushMicrotask()

		expect(store.peek(count)).toBe(1)
	})

	it('reads atoms and families in effects without tracking dependencies', async () => {
		const source = primitiveAtom(1)
		const values = atomFamily((key: string) => primitiveAtom(key.length))
		const observed = derivedAtom(
			(read) => read(source) * 2,
			() => {},
		)
		const runs = vi.fn()
		const trigger = primitiveAtom(0, {
			effect: (next, _last, get) => {
				runs(next, get(source), get(observed), get(values, 'key'))
			},
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
		const target = primitiveAtom(0)
		const doubled = derivedAtom(
			(read) => read(target) * 2,
			(_read, write, value: number) => write(target, value / 2),
		)
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const trigger = primitiveAtom(0, {
			effect: (next, _last, _get, set) => {
				if (next === undefined) return
				set(target, 1)
				set(doubled, 6)
				set(values, 'key', (value) => value + 1)
			},
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
		const count = primitiveAtom(0, { effect: doer })
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

	it('cleans up on unmount without rerunning the effect', async () => {
		const cleanup = vi.fn()
		const doer = vi.fn(() => cleanup)
		const count = primitiveAtom(0, { effect: doer })
		const store = createStore()
		const unsubscribe = store.subscribe(count, () => {})

		await flushMicrotask()
		unsubscribe()

		expect(doer).toHaveBeenLastCalledWith(
			0,
			undefined,
			expect.any(Function),
			expect.any(Function),
		)
		expect(cleanup).toHaveBeenCalledOnce()

		store.send(count, 1)
		await flushMicrotask()

		expect(doer).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()

		store.subscribe(count, () => {})
		await flushMicrotask()

		expect(cleanup).toHaveBeenCalledOnce()
		expect(doer).toHaveBeenLastCalledWith(
			1,
			undefined,
			expect.any(Function),
			expect.any(Function),
		)
	})

	it('does not mount dependants just because their dependency is subscribed', async () => {
		const count = primitiveAtom(1)
		const effect = vi.fn()
		const double = derivedAtom(
			(read) => read(count) * 2,
			() => {},
			{ effect },
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
		const effect = (name: string) => () => {
			events.push(`${name}:mount`)
			return () => {
				events.push(`${name}:cleanup`)
			}
		}
		const source = primitiveAtom(1, { effect: effect('source') })
		const left = derivedAtom<number>((read) => read(source), undefined, {
			effect: effect('left'),
		})
		const right = derivedAtom<number>((read) => read(source), undefined, {
			effect: effect('right'),
		})
		const leaf = derivedAtom<number>(
			(read) => read(left) + read(right),
			undefined,
			{ effect: effect('leaf') },
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
			'left:cleanup',
			'right:cleanup',
			'source:cleanup',
		])
	})

	it('keeps shared dependencies mounted until their last consumer releases them', async () => {
		const cleanup = vi.fn()
		const effect = vi.fn(() => cleanup)
		const source = primitiveAtom(1, { effect })
		const left = derivedAtom(
			(read) => read(source),
			() => {},
		)
		const right = derivedAtom(
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
		expect(effect).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	it('mounts new conditional dependencies and releases old ones', async () => {
		const firstCleanup = vi.fn()
		const firstEffect = vi.fn(() => firstCleanup)
		const secondCleanup = vi.fn()
		const secondEffect = vi.fn(() => secondCleanup)
		const first = primitiveAtom(1, { effect: firstEffect })
		const second = primitiveAtom(2, { effect: secondEffect })
		const selectFirst = primitiveAtom(true)
		const selected = derivedAtom(
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
		expect(firstEffect).toHaveBeenCalledOnce()
		expect(firstCleanup).toHaveBeenCalledOnce()
		expect(secondEffect).toHaveBeenCalledOnce()
		unsubscribe()
		expect(secondEffect).toHaveBeenCalledOnce()
		expect(secondCleanup).toHaveBeenCalledOnce()
	})

	it('does not release references twice or release a later subscription', async () => {
		const cleanup = vi.fn()
		const effect = vi.fn(() => cleanup)
		const atom = primitiveAtom(1, { effect })
		const store = createStore()
		const notify = vi.fn()
		const unsubscribe = store.subscribe(atom, notify)
		await flushMicrotask()
		unsubscribe()
		expect(effect).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()

		const unsubscribeAgain = store.subscribe(atom, notify)
		await flushMicrotask()
		unsubscribe()
		store.send(atom, 2)
		await flushMicrotask()
		expect(notify).toHaveBeenCalledOnce()
		expect(effect).toHaveBeenCalledTimes(3)
		expect(cleanup).toHaveBeenCalledTimes(2)
		unsubscribeAgain()
		unsubscribeAgain()
		expect(effect).toHaveBeenCalledTimes(3)
		expect(cleanup).toHaveBeenCalledTimes(3)
	})

	it('does not acquire extra references for repeated or retained dependency reads', async () => {
		const cleanup = vi.fn()
		const sourceEffect = vi.fn(() => cleanup)
		const source = primitiveAtom(1, { effect: sourceEffect })
		const trigger = primitiveAtom(0)
		const selected = derivedAtom(
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
		expect(sourceEffect).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	it('keeps dependency ownership balanced when cleanup remounts a consumer', async () => {
		const cleanup = vi.fn()
		const sourceEffect = vi.fn(() => cleanup)
		const source = primitiveAtom(1, { effect: sourceEffect })
		let remount = () => {}
		const consumer = derivedAtom<number>((read) => read(source), undefined, {
			effect: () => () => remount(),
		})
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
		expect(sourceEffect).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	it('releases dependency references after several conditional switches', async () => {
		const firstEffect = vi.fn()
		const secondEffect = vi.fn()
		const first = primitiveAtom(1, { effect: firstEffect })
		const second = primitiveAtom(2, { effect: secondEffect })
		const selectFirst = primitiveAtom(true)
		const selected = derivedAtom(
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
		expect(firstEffect.mock.calls.map(([next]) => next)).toEqual([1, 1, 1])
		expect(secondEffect.mock.calls.map(([next]) => next)).toEqual([2, 2])
	})

	it('subscribes to an atom family member', () => {
		const names = atomFamily((key: string) => primitiveAtom(key))
		const store = createStore()

		const unsubscribe = store.subscribe(names, 'first', () => {})

		expect(unsubscribe).toBeTypeOf('function')
		unsubscribe()
	})

	it('uses the family hash to identify members', () => {
		const create = vi.fn((key: { id: string }) => primitiveAtom(key.id))
		const names = atomFamily(create, { hash: (key) => key.id })
		const store = createStore()

		expect(store.peek(names, { id: 'first' })).toBe('first')
		expect(store.peek(names, { id: 'first' })).toBe('first')
		expect(create).toHaveBeenCalledOnce()
	})

	it('does not cache atom family members when TTL is negative', () => {
		const create = vi.fn((key: string) => primitiveAtom(key))
		const names = atomFamily(create, { TTL: TRANSIENT })
		const store = createStore()

		expect(store.peek(names, 'first')).toBe('first')
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('reuses one resolved transient family member for all operations', async () => {
		const create = vi.fn((key: string) => primitiveAtom(key))
		const names = atomFamily(create, { TTL: TRANSIENT })
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
		const create = vi.fn((key: string) => primitiveAtom(key))
		const names = atomFamily(create)
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
		const create = vi.fn((key: string) => primitiveAtom(key))
		const names = atomFamily(create)
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
		const create = vi.fn((key: string) => primitiveAtom(key))
		const names = atomFamily(create, { TTL: Infinity })
		const store = createStore()
		const unsubscribe = store.subscribe(names, 'first', () => {})

		unsubscribe()
		await flushMicrotask()
		store.peek(names, 'first')

		expect(create).toHaveBeenCalledOnce()
	})

	it('removes an unmounted atom family member after its positive TTL', async () => {
		vi.useFakeTimers()
		const create = vi.fn((key: string) => primitiveAtom(key))
		const names = atomFamily(create, { TTL: 100 })
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
		const create = vi.fn((key: string) => primitiveAtom(key))
		const names = atomFamily(create, { TTL: 100 })
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
		const source = primitiveAtom(0, { effect: effect('source') })
		const left = derivedAtom<number>((read) => read(source) + 1, undefined, {
			effect: effect('left'),
		})
		const right = derivedAtom<number>((read) => read(source) + 2, undefined, {
			effect: effect('right'),
		})
		const leaf = derivedAtom<number>(
			(read) => read(left) + read(right),
			undefined,
			{ effect: effect('leaf') },
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
		const source = primitiveAtom(0, {
			effect: (next) => {
				events.push(`run:source:${next}`)
				return () => {
					events.push(`cleanup:source:${next}`)
				}
			},
		})
		const parity = derivedAtom<number>((read) => read(source) % 2, undefined, {
			effect: (next) => {
				events.push(`run:parity:${next}`)
				return () => {
					events.push(`cleanup:parity:${next}`)
				}
			},
		})
		const store = createStore()
		const unsubscribe = store.subscribe(parity, () => {})
		await flushMicrotask()
		events.length = 0
		store.send(source, 2)
		await flushMicrotask()
		expect(events).toEqual(['cleanup:source:0', 'run:source:2'])
		events.length = 0
		unsubscribe()
		expect(events).toEqual(['cleanup:parity:0', 'cleanup:source:2'])
	})

	it('does not repeat cleanup or rerun effects when cleanup unsubscribes the consumer', async () => {
		const events: string[] = []
		let unsubscribe = () => {}
		const source = primitiveAtom(0, {
			effect: (next) => {
				events.push(`run:source:${next}`)
				return () => {
					events.push(`cleanup:source:${next}`)
				}
			},
		})
		const consumer = derivedAtom<number>((read) => read(source), undefined, {
			effect: (next) => {
				events.push(`run:consumer:${next}`)
				return () => {
					events.push(`cleanup:consumer:${next}`)
					unsubscribe()
				}
			},
		})
		const store = createStore()
		unsubscribe = store.subscribe(consumer, () => {})
		await flushMicrotask()
		events.length = 0
		store.send(source, 1)
		await flushMicrotask()
		expect(events).toEqual(['cleanup:consumer:0', 'cleanup:source:0'])
	})

	it('runs the previous cleanup before rerunning an effect', async () => {
		const events: string[] = []
		const count = primitiveAtom(0, {
			effect: (next) => {
				events.push(`run:${next}`)
				return () => events.push(`cleanup:${next}`)
			},
		})
		const store = createStore()

		store.subscribe(count, () => {})
		await flushMicrotask()
		store.send(count, 1)
		await flushMicrotask()

		expect(events).toEqual(['run:0', 'cleanup:0', 'run:1'])
	})
})

describe('command atoms', () => {
	it('runs queued sends once, FIFO, after a microtask without subscribers', async () => {
		const calls: number[] = []
		const command = commandAtom((_read, _write, value: number) =>
			calls.push(value),
		)
		const store = createStore()
		store.send(command, 1)
		store.send(command, 2)
		expect(calls).toEqual([])
		await flushMicrotask()
		expect(calls).toEqual([1, 2])
	})

	it('runs after mounts/effects and queues their commands in the next batch', async () => {
		const order: string[] = []
		const command = commandAtom((_read, _write, label: string) => {
			order.push(label)
			if (label === 'first') store.send(command, 'second')
		})
		const trigger = primitiveAtom(0, {
			onMount: (_read, write) => {
				order.push('mount')
				write(command, 'mount-command')
			},
			effect: (_next, _last, _read, write) => {
				order.push('effect')
				write(command, 'first')
			},
		})
		const store = createStore()
		const release = store.subscribe(trigger, () => {})
		store.send(command, 'same-batch')
		await flushMicrotask()
		expect(order).toEqual(['mount', 'effect', 'same-batch'])
		await flushMicrotask()
		expect(order).toEqual([
			'mount',
			'effect',
			'same-batch',
			'mount-command',
			'first',
		])
		expect(order).not.toContain('second')
		await flushMicrotask()
		expect(order.at(-1)).toBe('second')
		release()
	})

	it('reads committed and own pending values while peek remains committed', async () => {
		const value = primitiveAtom(1)
		const seen: number[] = []
		const command = commandAtom((read, write) => {
			seen.push(read(value))
			write(value, read(value) + 1)
			seen.push(read(value))
			seen.push(store.peek(value))
		})
		const store = createStore()
		store.send(value, 5)
		store.send(command)
		await flushMicrotask()
		expect(seen).toEqual([5, 6, 5])
		expect(store.peek(value)).toBe(5)
		await flushMicrotask()
		expect(store.peek(value)).toBe(6)
	})

	it('dispatches through resolved atoms, derived setters and family members', async () => {
		const values: number[] = []
		const command = commandAtom((_read, _write, n: number) => values.push(n))
		const family = atomFamily((_key: string) => command)
		const derived = derivedAtom(null, (_read, write, n: number) =>
			write(command, n),
		)
		const store = createStore()
		store.resolve(command).send(1)
		store.send(derived, 2)
		store.send(family, 'key', 3)
		await flushMicrotask()
		expect(values).toEqual([1, 2, 3])
		expect(() => store.peek(command)).toThrow()
		expect(() => store.resolve(command).peek()).toThrow()
		expect(() => store.subscribe(command, () => {})).toThrow()
		expect(() => store.peek(derivedAtom((read) => read(command)))).toThrow()
	})

	it('continues after command errors, performs housekeeping, and recovers', async () => {
		const calls: string[] = []
		const identities: object[] = []
		const family = atomFamily((_key: string) => primitiveAtom({}), { TTL: 0 })
		const store = createStore()
		let scheduled!: VoidFunction
		const capturedQueue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((cb) => {
				scheduled = cb
			})
		const familyRelease = store.subscribe(family, 'key', () => {})
		const beforeEviction = store.peek(family, 'key')
		const identityCommand = commandAtom((read, _write) => {
			identities.push(read(family, 'key'))
		})
		store.send(identityCommand)
		familyRelease()
		const errorCommand = commandAtom((_read, _write, value: string) => {
			calls.push(value)
			if (value !== 'ok')
				throw value === 'undefined' ? undefined : new Error(value)
		})
		store.send(errorCommand, 'first')
		store.send(errorCommand, 'undefined')
		store.send(errorCommand, 'ok')
		capturedQueue.mockRestore()
		let didThrow = false
		let thrown: unknown
		try {
			scheduled()
		} catch (error) {
			didThrow = true
			thrown = error
		}
		expect(didThrow).toBe(true)
		expect(thrown).toBeUndefined()
		expect(identities).toEqual([beforeEviction])
		expect(store.peek(family, 'key')).not.toBe(beforeEviction)
		expect(calls).toEqual(['first', 'undefined', 'ok'])
		store.send(errorCommand, 'ok')
		await flushMicrotask()
		expect(calls.at(-1)).toBe('ok')
	})

	it('skips hydrated command entries and setter dispatches but applies other writes', () => {
		const calls: number[] = []
		const command = commandAtom((_read, _write, n: number) => calls.push(n))
		const value = primitiveAtom(0)
		const derived = derivedAtom(null, (_read, write, n: number) => {
			write(value, n)
			write(command, n)
		})
		const store = createStore([
			[command, 1],
			[derived, 2],
		] as const)
		expect(store.peek(value)).toBe(2)
		expect(calls).toEqual([])
		store.send(command, 3)
		return Promise.resolve().then(() => expect(calls).toEqual([3]))
	})
})

describe('onMount', () => {
	it.each(['primitive', 'derived'] as const)(
		'keeps %s resources until the last subscriber leaves',
		async (kind) => {
			const cleanup = vi.fn()
			const onMount = vi.fn(() => cleanup)
			const effect = vi.fn()
			const source = primitiveAtom(0)
			const atom =
				kind === 'primitive'
					? primitiveAtom(0, { onMount, effect })
					: derivedAtom(
							(read) => read(source),
							(_read, set, value: SetStateWithReset<number>) =>
								set(source, value),
							{ onMount, effect },
						)
			const store = createStore()
			store.peek(atom)
			expect(onMount).not.toHaveBeenCalled()
			const release = store.subscribe(atom, vi.fn())
			const releaseOther = store.subscribe(atom, vi.fn())
			await Promise.resolve()
			expect(onMount).toHaveBeenCalledOnce()
			store.send(atom, 1)
			await Promise.resolve()
			expect(onMount).toHaveBeenCalledOnce()
			expect(cleanup).not.toHaveBeenCalled()
			expect(effect).toHaveBeenCalledTimes(2)
			release()
			expect(cleanup).not.toHaveBeenCalled()
			releaseOther()
			expect(cleanup).toHaveBeenCalledOnce()
			const releaseAgain = store.subscribe(atom, vi.fn())
			await Promise.resolve()
			expect(onMount).toHaveBeenCalledTimes(2)
			releaseAgain()
			expect(cleanup).toHaveBeenCalledTimes(2)
		},
	)

	it('mounts dependencies first and cleans up consumers first', async () => {
		const order: string[] = []
		const source = primitiveAtom(0, {
			onMount: () => {
				order.push('source mount')
				return () => {
					order.push('source cleanup')
				}
			},
		})
		const consumer = derivedAtom(
			(get) => get(source),
			() => {},
			{
				onMount: (get, set) => {
					order.push('consumer mount')
					set(source, get(source) + 1)
					return () => {
						order.push('consumer cleanup')
					}
				},
			},
		)
		const store = createStore()
		const release = store.subscribe(consumer, vi.fn())
		await Promise.resolve()
		release()
		expect(order).toEqual([
			'source mount',
			'consumer mount',
			'consumer cleanup',
			'source cleanup',
		])
	})
})

describe('mount scheduling', () => {
	it('skips callbacks when released before the mount microtask', async () => {
		const onMount = vi.fn()
		const effect = vi.fn()
		const atom = primitiveAtom(0, { onMount, effect })
		const store = createStore()
		const release = store.subscribe(atom, vi.fn())
		expect(onMount).not.toHaveBeenCalled()
		expect(effect).not.toHaveBeenCalled()
		release()
		await Promise.resolve()
		expect(onMount).not.toHaveBeenCalled()
		expect(effect).not.toHaveBeenCalled()
	})

	it('settles mount writes before dependent mounts and initial effects', async () => {
		const order: string[] = []
		const source = primitiveAtom(0, {
			onMount: (_get, set) => {
				order.push('source mount')
				set(source, 2)
				return () => {
					order.push('source unmount')
				}
			},
			effect: (next) => {
				order.push(`source effect:${next}`)
				return () => {
					order.push('source effect cleanup')
				}
			},
		})
		const consumer = derivedAtom(
			(get) => get(source) * 2,
			() => {},
			{
				onMount: (get) => {
					order.push(`consumer mount:${get(source)}`)
					return () => {
						order.push('consumer unmount')
					}
				},
				effect: (next) => {
					order.push(`consumer effect:${next}`)
					return () => {
						order.push('consumer effect cleanup')
					}
				},
			},
		)
		const store = createStore()
		const release = store.subscribe(consumer, vi.fn())
		expect(order).toEqual([])
		await Promise.resolve()
		expect(order).toEqual([
			'source mount',
			'consumer mount:2',
			'source effect:2',
			'consumer effect:4',
		])
		order.length = 0
		release()
		expect(order).toEqual([
			'consumer effect cleanup',
			'consumer unmount',
			'source effect cleanup',
			'source unmount',
		])
	})
})

describe('lifecycle error isolation', () => {
	it('continues fresh mounts and effects after effect-prepass dependency cleanup throws', async () => {
		const selector = primitiveAtom(true)
		const oldDep = primitiveAtom(1, {
			effect: () => () => {
				order.push('old cleanup')
				throw new Error('cleanup failed')
			},
		})
		const nextDep = primitiveAtom(2, {
			onMount: () => {
				order.push('fresh mount')
			},
			effect: () => {
				order.push('fresh effect')
			},
		})
		const order: string[] = []
		const consumer = derivedAtom(
			(get) => (get(selector) ? get(oldDep) : get(nextDep)),
			undefined,
			{ effect: () => {} },
		)
		const store = createStore()
		const release = store.subscribe(consumer, vi.fn())
		await flushMicrotask()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		try {
			store.send(selector, false)
			const flush = queued.shift()
			expect(flush).toBeTypeOf('function')
			expect(() => flush!()).toThrow('cleanup failed')
			expect(order).toEqual(['old cleanup', 'fresh mount', 'fresh effect'])
			release()
		} finally {
			queue.mockRestore()
		}
	})

	it('applies writes from a throwing mount and remounts it only after release', () => {
		const written = primitiveAtom(0)
		const marker = new Error('mount failed')
		let calls = 0
		const atom = primitiveAtom(0, {
			onMount: (_get, set) => {
				calls++
				set(written, calls)
				throw marker
			},
		})
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		const release = store.subscribe(atom, vi.fn())
		expect(() => queued.shift()!()).toThrow(marker)
		expect(store.peek(written)).toBe(1)
		release()
		const remount = store.subscribe(atom, vi.fn())
		expect(() => queued.shift()!()).toThrow(marker)
		expect(calls).toBe(2)
		remount()
		queue.mockRestore()
	})

	it('applies throwing consumer mount writes and allows an independent later batch', () => {
		const source = primitiveAtom(0)
		const written = primitiveAtom(0)
		let calls = 0
		const consumer = derivedAtom((get) => get(source), undefined, {
			onMount: (_get, set) => {
				calls++
				set(written, calls)
				throw 'consumer mount failed'
			},
		})
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		store.subscribe(consumer, vi.fn())
		expect(() => queued.shift()!()).toThrow('consumer mount failed')
		expect(store.peek(written)).toBe(1)
		store.subscribe(primitiveAtom(1), vi.fn())
		expect(() => queued.shift()!()).not.toThrow()
		expect(calls).toBe(1)
		queue.mockRestore()
	})

	it('continues all mounts and preserves the last undefined thrown value', () => {
		const seen: number[] = []
		const first = primitiveAtom(0, {
			onMount: () => {
				seen.push(1)
				throw 'first'
			},
		})
		const last = primitiveAtom(0, {
			onMount: () => {
				seen.push(2)
				throw undefined
			},
		})
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		store.subscribe(first, vi.fn())
		store.subscribe(last, vi.fn())
		let thrown: unknown = 'not thrown'
		try {
			queued.shift()!()
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeUndefined()
		expect(seen).toEqual([1, 2])
		queue.mockRestore()
	})

	it('does not let an earlier obsolete-dependency cleanup overwrite a later effect error', () => {
		const selector = primitiveAtom(true)
		const oldDep = primitiveAtom(1, {
			effect: () => () => {
				throw undefined
			},
		})
		const nextDep = primitiveAtom(2)
		const consumer = derivedAtom(
			(get) => (get(selector) ? get(oldDep) : get(nextDep)),
			undefined,
			{
				effect: () => () => {
					throw 'first'
				},
			},
		)
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		const release = store.subscribe(consumer, vi.fn())
		queued.shift()!()
		store.send(selector, false)
		let thrown: unknown
		let failed = false
		try {
			queued.shift()!()
		} catch (error) {
			failed = true
			thrown = error
		}
		expect(failed).toBe(true)
		expect(thrown).toBe('first')
		expect(release).toThrow('first')
		queue.mockRestore()
	})

	it('keeps the last command-era dependency cleanup error after an earlier command throws', () => {
		const selector = primitiveAtom(true)
		const first = commandAtom(() => {
			throw new Error('first command')
		})
		const oldDep = primitiveAtom(1, {
			effect: () => () => {
				throw undefined
			},
		})
		const nextDep = primitiveAtom(2)
		const consumer = derivedAtom((get) =>
			get(selector) ? get(oldDep) : get(nextDep),
		)
		const peekConsumer = commandAtom((read) => read(consumer))
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		const release = store.subscribe(consumer, vi.fn())
		queued.shift()!()
		store.send(selector, false)
		store.send(first)
		store.send(peekConsumer)
		let thrown: unknown = 'not thrown'
		try {
			queued.shift()!()
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeUndefined()
		release()
		queue.mockRestore()
	})

	it('preserves later cleanup failures after an earlier effect failure', () => {
		const selector = primitiveAtom(true)
		const oldDep = primitiveAtom(1, {
			effect: () => () => {
				throw undefined
			},
		})
		const nextDep = primitiveAtom(2)
		const seen: string[] = []
		const consumer = derivedAtom(
			(get) => (get(selector) ? get(oldDep) : get(nextDep)),
			undefined,
			{
				effect: () => () => {
					seen.push('effect cleanup')
					throw 'effect error'
				},
			},
		)
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		const release = store.subscribe(consumer, vi.fn())
		queued.shift()!()
		store.send(selector, false)
		let thrown: unknown = 'not thrown'
		try {
			queued.shift()!()
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBe('effect error')
		expect(seen).toEqual(['effect cleanup'])
		expect(release).toThrow('effect error')
		queue.mockRestore()
	})

	it('handles 20,000 throwing mounts and dependency cleanups iteratively', () => {
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		let mountCallbacks = 0
		const mounts = Array.from({ length: 20_000 }, () =>
			primitiveAtom(0, {
				onMount: () => {
					mountCallbacks++
					throw 'counted'
				},
			}),
		)
		const releases = mounts.map((atom) => store.subscribe(atom, vi.fn()))
		let thrown: unknown
		try {
			queued.shift()!()
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBe('counted')
		expect(mountCallbacks).toBe(20_000)
		for (const release of releases) release()

		const deps = Array.from({ length: 20_000 }, (_, index) =>
			primitiveAtom(index, {
				effect: () => () => {
					throw index
				},
			}),
		)
		const consumer = derivedAtom((get) =>
			deps.reduce((sum, dep) => sum + get(dep), 0),
		)
		const releaseConsumer = store.subscribe(consumer, vi.fn())
		queued.shift()!()
		let cleanupError: unknown
		try {
			releaseConsumer()
		} catch (error) {
			cleanupError = error
		}
		expect(cleanupError).toBe(19_999)
		queue.mockRestore()
	})

	it('runs family mount cleanup, releases deps, and evicts despite throwing effect cleanup', async () => {
		const events: string[] = []
		const dep = primitiveAtom(1, {
			effect: () => () => {
				events.push('dep cleanup')
			},
		})
		let creates = 0
		const mountCleanup = vi.fn(() => {
			events.push('mount cleanup')
		})
		const members = atomFamily((key: string) => {
			creates++
			return derivedAtom((get) => get(dep) + key.length, undefined, {
				onMount: () => mountCleanup,
				effect: () => () => {
					events.push('effect cleanup')
					throw 'effect failed'
				},
			})
		})
		const store = createStore()
		const release = store.subscribe(members, 'x', vi.fn())
		await flushMicrotask()
		expect(() => release()).toThrow('effect failed')
		expect(mountCleanup).toHaveBeenCalledOnce()
		expect(events).toEqual(['effect cleanup', 'mount cleanup', 'dep cleanup'])
		await flushMicrotask()
		store.peek(members, 'x')
		expect(creates).toBe(2)
	})

	it('continues dropping both dependencies and committing queued primitive updates', () => {
		const selector = primitiveAtom(true)
		const a = primitiveAtom(1, {
			effect: () => () => {
				throw 'A cleanup'
			},
		})
		const bCleaned = vi.fn()
		const b = primitiveAtom(2, { effect: () => () => bCleaned() })
		const unrelated = primitiveAtom(0)
		const consumer = derivedAtom(
			(get) => (get(selector) ? get(a) + get(b) : 0),
			undefined,
			{ effect: () => {} },
		)
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		store.subscribe(consumer, vi.fn())
		queued.shift()!()
		store.send(selector, false)
		store.send(unrelated, 1)
		let thrown: unknown
		try {
			queued.shift()!()
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBe('A cleanup')
		expect(bCleaned).toHaveBeenCalledOnce()
		expect(store.peek(unrelated)).toBe(1)
		queue.mockRestore()
	})

	it('reentrant dependency cleanup does not double-release through unmount and remount', () => {
		const selector = primitiveAtom(true)
		const events: string[] = []
		let releaseConsumer: (() => void) | undefined
		let remount: (() => void) | undefined
		const oldDep = primitiveAtom(1, {
			effect: () => () => {
				events.push('old cleanup')
				releaseConsumer?.()
				releaseConsumer = undefined
				remount = store.subscribe(consumer, vi.fn())
			},
		})
		const nextDep = primitiveAtom(2, {
			effect: () => () => {
				events.push('next cleanup')
			},
		})
		const consumer = derivedAtom((get) =>
			get(selector) ? get(oldDep) : get(nextDep),
		)
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		releaseConsumer = store.subscribe(consumer, vi.fn())
		queued.shift()!()
		store.send(selector, false)
		queued.shift()!()
		releaseConsumer?.()
		releaseConsumer = undefined
		expect(events).toEqual(['old cleanup'])
		remount?.()
		expect(events).toEqual(['old cleanup'])
		queue.mockRestore()
	})

	it('resets flush state after a derived getter throws during mount', () => {
		let getterCalls = 0
		const trigger = primitiveAtom(false)
		const writer = primitiveAtom(0, {
			onMount: (_get, set) => set(trigger, true),
		})
		const broken = derivedAtom((get) => {
			if (!get(trigger)) return 0
			getterCalls++
			throw 'getter failed'
		})
		const store = createStore()
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		const healthyEffect = vi.fn()
		const healthy = primitiveAtom(1, { effect: healthyEffect })
		store.subscribe(writer, vi.fn())
		expect(() => store.subscribe(broken, vi.fn())).not.toThrow()
		const flush = queued.shift()
		expect(flush).toBeTypeOf('function')
		expect(() => flush!()).toThrow('getter failed')
		expect(getterCalls).toBe(1)
		store.subscribe(healthy, vi.fn())
		expect(queued).toHaveLength(1)
		expect(() => queued.shift()!()).not.toThrow()
		expect(getterCalls).toBe(1)
		expect(healthyEffect).toHaveBeenCalledOnce()
		queue.mockRestore()
	})

	it('runs all throwing cleanups and callbacks, then propagates the last error', () => {
		const order: string[] = []
		const values = [primitiveAtom(0), primitiveAtom(0)]
		const atoms = values.map((value, index) =>
			derivedAtom((get) => get(value), undefined, {
				effect: (next) => {
					if (next > 0) {
						order.push(`effect ${index}`)
						throw `effect ${index}`
					}
					return () => {
						order.push(`cleanup ${index}`)
						throw `cleanup ${index}`
					}
				},
			}),
		)
		const store = createStore()
		const familyValues: object[] = []
		const family = atomFamily(
			() => {
				const value = {}
				familyValues.push(value)
				return primitiveAtom(value)
			},
			{ TTL: 0 },
		)
		const healthy = primitiveAtom(0, {
			effect: () => {
				order.push('healthy effect')
			},
		})
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		const familyRelease = store.subscribe(family, 'key', vi.fn())
		const originalFamilyValue = familyValues[0]
		const releases = [
			...atoms.map((atom) => store.subscribe(atom, vi.fn())),
			store.subscribe(healthy, vi.fn()),
		]
		queued.shift()!()
		const trigger = primitiveAtom(0)
		const consumer = derivedAtom((get) => get(trigger), undefined, {
			effect: () => {
				if (store.peek(trigger) === 0)
					return () => {
						order.push('throwing cleanup')
						throw 'cleanup last'
					}
				order.push('throwing callback')
				throw 'callback last'
			},
		})
		const releaseConsumer = store.subscribe(consumer, vi.fn())
		queued.shift()!()
		order.length = 0
		familyRelease()
		store.send(values[0]!, 1)
		store.send(values[1]!, 1)
		store.send(healthy, 1)
		store.send(trigger, 1)
		store.send(
			commandAtom(() => {
				order.push('command')
				expect(store.peek(family, 'key')).toBe(originalFamilyValue)
			}),
		)
		let thrown: unknown
		try {
			queued.shift()!()
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBe('callback last')
		expect(order).toEqual([
			'throwing cleanup',
			'cleanup 1',
			'cleanup 0',
			'effect 0',
			'effect 1',
			'healthy effect',
			'throwing callback',
			'command',
		])
		expect(store.peek(family, 'key')).not.toBe(originalFamilyValue)
		store.send(healthy, 2)
		expect(() => queued.shift()!()).not.toThrow()
		expect(() => releaseConsumer()).not.toThrow()
		for (const release of releases) release()
		queue.mockRestore()
	})

	it('finishes notifying every subscriber before propagating the last thrown value', () => {
		const source = primitiveAtom(0)
		const store = createStore()
		const first = new Error('first')
		const last = new Error('last')
		const seen: number[] = []
		const queued: VoidFunction[] = []
		const queue = vi
			.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((fn) => {
				queued.push(fn)
			})
		store.subscribe(source, () => {
			throw first
		})
		store.subscribe(source, () => {
			seen.push(1)
			throw last
		})
		store.subscribe(source, () => seen.push(2))
		const initialFlush = queued.shift()
		initialFlush?.()
		seen.length = 0
		store.send(source, 1)
		const flush = queued.shift()
		expect(flush).toBeTypeOf('function')
		expect(() => flush!()).toThrow(last)
		expect(seen).toEqual([1, 2])
		queue.mockRestore()
	})
})

describe('effect values', () => {
	it.each(['primitive', 'derived'] as const)(
		'treats undefined as a real %s value and only cleans up on unmount',
		async (kind) => {
			const cleanup = vi.fn()
			const effect = vi.fn(() => cleanup)
			const source = primitiveAtom<number | undefined>(
				undefined,
				kind === 'primitive' ? { effect } : undefined,
			)
			const atom =
				kind === 'primitive'
					? source
					: derivedAtom(
							(get) => get(source),
							(_get, set, value: SetStateWithReset<number | undefined>) =>
								set(source, value),
							{ effect },
						)
			const store = createStore()
			const release = store.subscribe(atom, vi.fn())
			await Promise.resolve()
			expect(effect).toHaveBeenCalledOnce()
			expect(effect.mock.calls[0]).toEqual([
				undefined,
				undefined,
				expect.any(Function),
				expect.any(Function),
			])
			store.send(atom, 1)
			await Promise.resolve()
			store.send(atom, undefined)
			await Promise.resolve()
			expect(effect).toHaveBeenCalledTimes(3)
			expect(effect.mock.calls[2]).toEqual([
				undefined,
				1,
				expect.any(Function),
				expect.any(Function),
			])
			release()
			release()
			expect(effect).toHaveBeenCalledTimes(3)
			expect(cleanup).toHaveBeenCalledTimes(3)
			const releaseAgain = store.subscribe(atom, vi.fn())
			await Promise.resolve()
			expect(effect).toHaveBeenCalledTimes(4)
			expect(effect.mock.calls[3]).toEqual([
				undefined,
				undefined,
				expect.any(Function),
				expect.any(Function),
			])
			releaseAgain()
			expect(cleanup).toHaveBeenCalledTimes(4)
		},
	)
})
