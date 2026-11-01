import { afterEach, assert, describe, expect, it, type Mock, vi } from 'vitest'

import { RESET, type SetStateWithReset } from '../functions'
import { shallowEqual } from '../shallow-equal'
import { createCommands } from './commandAtoms'
import {
	createStore,
	derivedAtom,
	atomFamily,
	hydrate,
	primitiveAtom,
	TRANSIENT,
	type AtomFamily,
	type AtomFamilyOptions,
	type AtomSymbol,
	type Read,
} from './store'

const flushMicrotask = () => Promise.resolve()

const internalInstance = (store: unknown, symbol: unknown) =>
	(store as any).instances.get(symbol)

const mountedSubCount = (store: unknown, symbol: unknown) =>
	internalInstance(store, symbol).mountedSubs.size as number

const mountCount = (store: unknown, symbol: unknown) =>
	internalInstance(store, symbol).mountCount as number

const expectNoStrongReferences = (
	store: unknown,
	symbol: unknown,
	dependants: Set<object>,
) => {
	const source = internalInstance(store, symbol) as object
	const holds = (value: unknown) => dependants.has(value as object)
	for (const value of Object.values(source)) {
		expect(holds(value)).toBe(false)
		if (value instanceof Set || Array.isArray(value)) {
			for (const item of value) expect(holds(item)).toBe(false)
		} else if (value instanceof Map) {
			for (const [entryKey, entryValue] of value) {
				expect(holds(entryKey)).toBe(false)
				expect(holds(entryValue)).toBe(false)
			}
		}
	}
}

const keptHandle = (TTL = 0) => {
	const create = vi.fn((key: string) => primitiveAtom(key))
	const names = atomFamily(create, { TTL })
	const store = createStore()
	const handle = store.resolve(names, 'first')
	return { create, names, store, handle }
}

describe('Store', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

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

	it('exposes only the settled value to diamond subscribers', async () => {
		const source = primitiveAtom(0)
		const left = derivedAtom((read) => read(source) + 1)
		const right = derivedAtom((read) => read(source) + 2)
		const leaf = derivedAtom((read) => read(left) + read(right))
		const store = createStore()
		const seen: number[] = []
		store.subscribe(leaf, () => seen.push(store.peek(leaf)))
		await flushMicrotask()

		store.send(source, 2)
		await flushMicrotask()

		expect(seen).toEqual([7])
	})

	it('invalidates every changed dependency before notifying a derived atom', async () => {
		const a = primitiveAtom(0)
		const b = primitiveAtom(0)
		const sum = derivedAtom((read) => read(a) + read(b))
		const store = createStore()
		const seen: number[] = []
		store.subscribe(sum, () => seen.push(store.peek(sum)))
		await flushMicrotask()

		store.send(a, 1)
		store.send(b, 2)
		await flushMicrotask()

		expect(seen).toEqual([3])
	})

	it.each([
		['first', 'second'],
		['second', 'first'],
	] as const)(
		'composes subscriber updaters with the whole committing batch (writes %s then %s)',
		async (firstWritten, secondWritten) => {
			const atoms = { first: primitiveAtom(0), second: primitiveAtom(0) }
			const values = { first: 1, second: 10 }
			const store = createStore()
			store.subscribe(atoms.first, () =>
				store.send(atoms.second, (value) => value + 1),
			)
			await flushMicrotask()

			store.send(atoms[firstWritten], values[firstWritten])
			store.send(atoms[secondWritten], values[secondWritten])
			await flushMicrotask()
			await flushMicrotask()

			expect(store.peek(atoms.second)).toBe(11)
		},
	)

	it('skips a subscriber unsubscribed by an earlier callback in the same delivery', async () => {
		const atom = primitiveAtom(0)
		const store = createStore()
		const later = vi.fn()
		let unsubscribeLater = () => {}
		const earlier = vi.fn(() => unsubscribeLater())
		const unsubscribeEarlier = store.subscribe(atom, earlier)
		unsubscribeLater = store.subscribe(atom, later)
		await flushMicrotask()

		store.send(atom, 1)
		await flushMicrotask()

		expect(earlier).toHaveBeenCalledOnce()
		expect(later).not.toHaveBeenCalled()

		unsubscribeEarlier()
	})

	it('delivers once per write to a callback that re-subscribes itself', async () => {
		const atom = primitiveAtom(0)
		const store = createStore()
		const notify = vi.fn(() => {
			unsubscribe()
			unsubscribe = store.subscribe(atom, notify)
		})
		let unsubscribe = store.subscribe(atom, notify)
		await flushMicrotask()

		store.send(atom, 1)
		await flushMicrotask()

		expect(notify).toHaveBeenCalledOnce()

		store.send(atom, 2)
		await flushMicrotask()

		expect(notify).toHaveBeenCalledTimes(2)

		unsubscribe()
	})

	it('skips a subscriber replaced by re-subscribing before its turn', async () => {
		const atom = primitiveAtom(0)
		const store = createStore()
		const second = vi.fn()
		const first = vi.fn(() => {
			if (first.mock.calls.length > 1) return
			unsubscribeSecond()
			unsubscribeSecond = store.subscribe(atom, second)
		})
		const unsubscribeFirst = store.subscribe(atom, first)
		let unsubscribeSecond = store.subscribe(atom, second)
		await flushMicrotask()

		store.send(atom, 1)
		await flushMicrotask()

		expect(second).not.toHaveBeenCalled()

		store.send(atom, 2)
		await flushMicrotask()

		expect(second).toHaveBeenCalledOnce()

		unsubscribeFirst()
		unsubscribeSecond()
	})

	it('delays a subscriber added during notification until a future notification', async () => {
		const atom = primitiveAtom(0)
		const store = createStore()
		const added = vi.fn()
		let unsubscribeAdded = () => {}
		const first = vi.fn(() => {
			if (first.mock.calls.length > 1) return
			unsubscribeAdded = store.subscribe(atom, added)
		})
		const unsubscribeFirst = store.subscribe(atom, first)
		await flushMicrotask()

		store.send(atom, 1)
		await flushMicrotask()

		expect(added).not.toHaveBeenCalled()

		store.send(atom, 2)
		await flushMicrotask()

		expect(added).toHaveBeenCalledOnce()

		unsubscribeFirst()
		unsubscribeAdded()
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
		const members = atomFamily((_key: string) =>
			derivedAtom((read) => read(doubled)),
		)
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
		const names = atomFamily((key: string) => primitiveAtom(key.toUpperCase()))
		const selected = derivedAtom(
			(read) => read(names, 'first'),
			(_read, _write, _event: never) => {},
		)
		const store = createStore()

		expect(store.peek(selected)).toBe('FIRST')
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

	it.each(['source', 'consumer'] as const)(
		'disposes the cleanup of an effect whose setup releases the %s',
		async (target) => {
			let release = () => {}
			const cleanup = vi.fn()
			const effect = vi.fn(() => {
				release()
				return cleanup
			})
			const source = primitiveAtom(0, { effect })
			const consumer = derivedAtom<number>((read) => read(source))
			const store = createStore()
			release =
				target === 'consumer'
					? store.subscribe(consumer, () => {})
					: store.subscribe(source, () => {})
			await flushMicrotask()
			expect(effect).toHaveBeenCalledOnce()
			expect(cleanup).toHaveBeenCalledOnce()
		},
	)

	it('disposes an old run and keeps the newer run cleanup when setup releases and remounts', async () => {
		const store = createStore()
		const cleanups: Mock<() => void>[] = []
		let release = () => {}
		let reenter = true
		const atom = primitiveAtom(0, {
			effect: () => {
				if (reenter) {
					reenter = false
					release()
					release = store.subscribe(atom, () => {})
				}
				const cleanup = vi.fn()
				cleanups.push(cleanup)
				return cleanup
			},
		})
		release = store.subscribe(atom, () => {})
		await flushMicrotask()
		expect(cleanups).toHaveLength(1)
		expect(cleanups[0]).toHaveBeenCalledOnce()
		await flushMicrotask()
		expect(cleanups).toHaveLength(2)
		expect(cleanups[0]).toHaveBeenCalledOnce()
		expect(cleanups[1]).not.toHaveBeenCalled()
		release()
		expect(cleanups[0]).toHaveBeenCalledOnce()
		expect(cleanups[1]).toHaveBeenCalledOnce()
	})

	describe('conditional dependency cleanup ordering', () => {
		const setup = (equal = false) => {
			const events: string[] = []
			const resource = (name: string, value: number) =>
				primitiveAtom(value, {
					effect: () => {
						events.push(`${name} setup`)
						return () => events.push(`${name} cleanup`)
					},
				})
			const first = resource('first', 1)
			const second = resource('second', equal ? 1 : 2)
			const chooseFirst = primitiveAtom(true)
			const store = createStore()
			const consumer = derivedAtom<number>(
				(read) => read(read(chooseFirst) ? first : second),
				undefined,
				{
					effect: (value) => {
						events.push(`consumer ${value} setup`)
						return () => events.push(`consumer ${value} cleanup`)
					},
				},
			)
			return { events, first, second, chooseFirst, store, consumer }
		}

		it('cleans the consumer before releasing its removed resource', async () => {
			const { events, chooseFirst, store, consumer } = setup()
			const release = store.subscribe(consumer, () => store.peek(consumer))
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			expect(events).toEqual([
				'consumer 1 cleanup',
				'first cleanup',
				'second setup',
				'consumer 2 setup',
			])
			release()
		})

		it('keeps nested removed dependencies alive for an unchanged ancestor effect', async () => {
			const { events, chooseFirst, first, second, store } = setup(true)
			const middle = derivedAtom((read) =>
				read(read(chooseFirst) ? first : second),
			)
			const consumer = derivedAtom<number>((read) => read(middle), undefined, {
				effect: () => () => events.push('ancestor cleanup'),
			})
			const release = store.subscribe(consumer, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			expect(events).toEqual(['second setup'])
			release()
			expect(events.indexOf('ancestor cleanup')).toBeLessThan(
				events.indexOf('first cleanup'),
			)
		})

		it('preserves old ownership when a removed intermediate consumer also switches', async () => {
			const { events, chooseFirst, first, second, store } = setup()
			const middle = derivedAtom((read) =>
				read(read(chooseFirst) ? first : second),
			)
			const outer = derivedAtom<number>(
				(read) => (read(chooseFirst) ? read(middle) : 0),
				undefined,
				{ effect: () => () => events.push('outer cleanup') },
			)
			const release = store.subscribe(outer, () => store.peek(outer))
			const releaseMiddle = store.subscribe(middle, () => store.peek(middle))
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			expect(events.indexOf('outer cleanup')).toBeLessThan(
				events.indexOf('first cleanup'),
			)
			release()
			releaseMiddle()
			expect(mountCount(store, first)).toBe(0)
			expect(mountCount(store, second)).toBe(0)
		})

		it('keeps a shared old resource through both consumer cleanups', async () => {
			const { events, chooseFirst, first, second, store, consumer } = setup()
			const other = derivedAtom<number>(
				(read) => read(read(chooseFirst) ? first : second),
				undefined,
				{ effect: () => () => events.push('other cleanup') },
			)
			const release = store.subscribe(consumer, () => {})
			const releaseOther = store.subscribe(other, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			expect(events.indexOf('first cleanup')).toBeGreaterThan(
				events.indexOf('consumer 1 cleanup'),
			)
			expect(events.indexOf('first cleanup')).toBeGreaterThan(
				events.indexOf('other cleanup'),
			)
			expect(events.filter((event) => event === 'first cleanup')).toHaveLength(
				1,
			)
			release()
			releaseOther()
		})

		it.each([false, true])(
			'cleans reversed dependencies after an equal consumer update: %s',
			async (updateWhileEqual) => {
				const events: string[] = []
				const choice = primitiveAtom(true)
				const source = primitiveAtom(1)
				const effect = (name: string) => (value: number) => {
					events.push(`${name}${value} setup`)
					return () => events.push(`${name}${value} cleanup`)
				}
				const b = derivedAtom<number>(
					(read): number => (read(choice) ? read(source) : read(a) + 1),
					undefined,
					{ effect: effect('B') },
				)
				const a = derivedAtom<number>(
					(read): number => (read(choice) ? Math.min(read(b), 1) + 1 : 1),
					undefined,
					{ effect: effect('A') },
				)
				const store = createStore()
				const releaseB = store.subscribe(b, () => {})
				const releaseA = store.subscribe(a, () => {})
				await flushMicrotask()
				if (updateWhileEqual) {
					store.send(source, 3)
					await flushMicrotask()
				}
				events.length = 0
				store.send(choice, false)
				await flushMicrotask()
				expect(events).toEqual([
					'A2 cleanup',
					`B${updateWhileEqual ? 3 : 1} cleanup`,
					'A1 setup',
					'B2 setup',
				])
				events.length = 0
				store.send(choice, true)
				await flushMicrotask()
				expect(events).toEqual([
					'B2 cleanup',
					'A1 cleanup',
					`B${updateWhileEqual ? 3 : 1} setup`,
					'A2 setup',
				])
				releaseA()
				releaseB()
			},
		)

		it.each([
			[false, false],
			[true, false],
			[false, true],
			[true, true],
		])(
			'releases equal-valued reversed dependencies with reversed release order %s and cleanup remount %s',
			async (reverseReleaseOrder, remount) => {
				const events: string[] = []
				const choice = primitiveAtom(true)
				let remountConsumer = () => {}
				const effect = (name: string) => () => {
					events.push(`${name} setup`)
					return () => {
						events.push(`${name} cleanup`)
						if (name === 'A') remountConsumer()
					}
				}
				const b = derivedAtom<number>(
					(read): number => (read(choice) ? 1 : read(a)),
					undefined,
					{ effect: effect('B') },
				)
				const a = derivedAtom<number>(
					(read): number => (read(choice) ? read(b) : 1),
					undefined,
					{ effect: effect('A') },
				)
				const store = createStore()
				const releaseB = store.subscribe(b, () => {})
				const releaseA = store.subscribe(a, () => {})
				let releaseAgain = () => {}
				if (remount)
					remountConsumer = () => {
						remountConsumer = () => {}
						releaseAgain = store.subscribe(b, () => {})
					}
				await flushMicrotask()
				events.length = 0
				store.send(choice, false)
				await flushMicrotask()
				expect(events).toEqual([])
				const releases = reverseReleaseOrder
					? [releaseB, releaseA]
					: [releaseA, releaseB]
				releases[0]!()
				expect(events).toEqual([])
				releases[1]!()
				if (remount) {
					expect(events).toEqual(['A cleanup'])
					await flushMicrotask()
					expect(events).toEqual(['A cleanup', 'A setup'])
					expect(mountCount(store, a)).toBe(1)
					expect(mountCount(store, b)).toBe(1)
					releaseAgain()
					expect(events).toEqual([
						'A cleanup',
						'A setup',
						'B cleanup',
						'A cleanup',
					])
				} else expect(events).toEqual(['A cleanup', 'B cleanup'])
				expect(mountCount(store, a)).toBe(0)
				expect(mountCount(store, b)).toBe(0)
			},
		)

		it.each([false, true])(
			'preserves original resource cleanup after equal-value double reversal with reversed release order %s',
			async (reverseReleaseOrder) => {
				const events: string[] = []
				const choice = primitiveAtom(true)
				let resourceLive = false
				let consumerSawLiveResource = false
				const b = derivedAtom<number>(
					(read): number => (read(choice) ? 1 : read(a)),
					undefined,
					{
						effect: () => {
							resourceLive = true
							return () => {
								events.push('B cleanup')
								resourceLive = false
							}
						},
					},
				)
				const a = derivedAtom<number>(
					(read): number => (read(choice) ? read(b) : 1),
					undefined,
					{
						effect: () => () => {
							events.push('A cleanup')
							consumerSawLiveResource = resourceLive
						},
					},
				)
				const store = createStore()
				const releaseB = store.subscribe(b, () => {})
				const releaseA = store.subscribe(a, () => {})
				await flushMicrotask()
				store.send(choice, false)
				await flushMicrotask()
				store.send(choice, true)
				await flushMicrotask()
				expect(events).toEqual([])
				const releases = reverseReleaseOrder
					? [releaseB, releaseA]
					: [releaseA, releaseB]
				releases[0]!()
				expect(events).toEqual([])
				releases[1]!()
				expect(events).toEqual(['A cleanup', 'B cleanup'])
				expect(consumerSawLiveResource).toBe(true)
				expect(mountCount(store, a)).toBe(0)
				expect(mountCount(store, b)).toBe(0)
			},
		)

		it.each([false, true])(
			'orders retained resources across intermediate effect reruns with an indirect resource: %s',
			async (indirect) => {
				const events: string[] = []
				const effect = (name: string) => (value: number) => {
					events.push(`${name}${value} setup`)
					return () => events.push(`${name}${value} cleanup`)
				}
				const firstResource = primitiveAtom(1, { effect: effect('first') })
				const first = derivedAtom((read) => read(firstResource))
				const second = primitiveAtom(1, { effect: effect('second') })
				const chooseFirst = primitiveAtom(true)
				const middle = derivedAtom(
					(read) =>
						read(chooseFirst)
							? indirect
								? read(first)
								: read(firstResource)
							: read(second),
					undefined,
					{ effect: effect('middle') },
				)
				const outer = derivedAtom(
					(read) => Math.min(read(middle), 1),
					undefined,
					{ effect: effect('outer') },
				)
				const store = createStore()
				const release = store.subscribe(outer, () => {})
				await flushMicrotask()
				store.send(chooseFirst, false)
				await flushMicrotask()
				store.send(second, 2)
				await flushMicrotask()
				expect(events).not.toContain('outer1 cleanup')
				expect(events).not.toContain('first1 cleanup')
				events.length = 0
				store.send(second, 0)
				store.send(firstResource, 3)
				await flushMicrotask()
				expect(events).toContain('outer1 cleanup')
				expect(events).toContain('first1 cleanup')
				expect(events.indexOf('outer1 cleanup')).toBeLessThan(
					events.indexOf('first1 cleanup'),
				)
				expect(events.indexOf('outer1 cleanup')).toBeLessThan(
					events.indexOf('middle2 cleanup'),
				)
				release()
				expect(mountCount(store, firstResource)).toBe(0)
				expect(mountCount(store, second)).toBe(0)
			},
		)

		it('keeps removed resources while equal values preserve the old effect', async () => {
			const { events, chooseFirst, second, first, store, consumer } =
				setup(true)
			const release = store.subscribe(consumer, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			expect(events).toEqual(['second setup'])
			const notify = vi.fn()
			const releaseNotify = store.subscribe(consumer, notify)
			store.send(first, 3)
			await flushMicrotask()
			expect(notify).not.toHaveBeenCalled()
			events.length = 0
			store.send(second, 2)
			await flushMicrotask()
			expect(events).toEqual([
				'consumer 1 cleanup',
				'first cleanup',
				'second cleanup',
				'second setup',
				'consumer 2 setup',
			])
			releaseNotify()
			release()
		})

		it('releases retained equal-value resources after the final consumer cleanup', async () => {
			const { events, chooseFirst, store, consumer } = setup(true)
			const release = store.subscribe(consumer, () => {})
			await flushMicrotask()
			store.send(chooseFirst, false)
			await flushMicrotask()
			events.length = 0
			release()
			expect(events[0]).toBe('consumer 1 cleanup')
			expect(events).toContain('first cleanup')
			expect(events).toContain('second cleanup')
		})

		it('preserves ownership when old resource cleanup remounts the consumer', async () => {
			const { events, chooseFirst, first, store, consumer } = setup()
			let releaseAgain = () => {}
			first.effect = () => () => {
				events.push('first cleanup')
				release()
				releaseAgain = store.subscribe(consumer, () => {})
			}
			const release = store.subscribe(consumer, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			await flushMicrotask()
			expect(events.indexOf('consumer 1 cleanup')).toBeLessThan(
				events.indexOf('first cleanup'),
			)
			expect(mountCount(store, consumer)).toBe(1)
			releaseAgain()
			expect(mountCount(store, consumer)).toBe(0)
			expect(events.filter((event) => event === 'first cleanup')).toHaveLength(
				1,
			)
			expect(events.filter((event) => event === 'second cleanup')).toHaveLength(
				1,
			)
		})
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

	describe('mounted dependency reconciliation', () => {
		const setup = () => {
			const firstCleanup = vi.fn()
			const secondCleanup = vi.fn()
			const firstUnmount = vi.fn()
			const secondUnmount = vi.fn()
			const firstEffect = vi.fn(() => firstCleanup)
			const secondEffect = vi.fn(() => secondCleanup)
			const firstMount = vi.fn(() => firstUnmount)
			const secondMount = vi.fn(() => secondUnmount)
			const first = primitiveAtom(1, {
				effect: firstEffect,
				onMount: firstMount,
			})
			const second = primitiveAtom(2, {
				effect: secondEffect,
				onMount: secondMount,
			})
			const selectFirst = primitiveAtom(true)
			const select = (read: Read) =>
				read(selectFirst) ? read(first) : read(second)
			const mocks = {
				firstEffect,
				firstMount,
				firstCleanup,
				firstUnmount,
				secondEffect,
				secondMount,
				secondCleanup,
				secondUnmount,
			}
			const initial: Record<keyof typeof mocks, number> = {
				firstEffect: 1,
				firstMount: 1,
				firstCleanup: 0,
				firstUnmount: 0,
				secondEffect: 0,
				secondMount: 0,
				secondCleanup: 0,
				secondUnmount: 0,
			}
			const swapped = {
				...initial,
				firstCleanup: 1,
				firstUnmount: 1,
				secondEffect: 1,
				secondMount: 1,
			}
			const released = { ...swapped, secondCleanup: 1, secondUnmount: 1 }
			const phases = { initial, swapped, released }
			const expectPhase = (phase: keyof typeof phases) => {
				for (const name of Object.keys(mocks) as (keyof typeof mocks)[])
					expect(mocks[name], name).toHaveBeenCalledTimes(phases[phase][name])
			}
			return { selectFirst, select, expectPhase }
		}

		it('swaps resources for a conditional consumer with an effect', async () => {
			const { selectFirst, select, expectPhase } = setup()
			const effect = vi.fn()
			const consumer = derivedAtom(select, () => {}, { effect })
			const store = createStore()
			const unsubscribe = store.subscribe(consumer, () => {})
			await flushMicrotask()
			expectPhase('initial')
			store.send(selectFirst, false)
			await flushMicrotask()
			expectPhase('swapped')
			expect(effect.mock.calls.map(([value]) => value)).toEqual([1, 2])
			unsubscribe()
			expectPhase('released')
		})

		it('swaps resources for subscribers that never peek', async () => {
			const { selectFirst, select, expectPhase } = setup()
			const consumer = derivedAtom(select, () => {})
			const store = createStore()
			const left = vi.fn()
			const right = vi.fn()
			const unsubscribeLeft = store.subscribe(consumer, left)
			const unsubscribeRight = store.subscribe(consumer, right)
			await flushMicrotask()
			expectPhase('initial')
			store.send(selectFirst, false)
			await flushMicrotask()
			expect(left).toHaveBeenCalledOnce()
			expect(right).toHaveBeenCalledOnce()
			expectPhase('swapped')
			unsubscribeLeft()
			unsubscribeRight()
			expectPhase('released')
		})

		it('swaps resources through nested consumers without effects', async () => {
			const { selectFirst, select, expectPhase } = setup()
			const inner = derivedAtom(select, () => {})
			const outer = derivedAtom(
				(read) => read(inner) * 10,
				() => {},
			)
			const store = createStore()
			const subscriber = vi.fn()
			const unsubscribe = store.subscribe(outer, subscriber)
			await flushMicrotask()
			expectPhase('initial')
			store.send(selectFirst, false)
			await flushMicrotask()
			expect(subscriber).toHaveBeenCalledOnce()
			expectPhase('swapped')
			unsubscribe()
			expectPhase('released')
		})

		it('keeps reconciling when a later mount write switches a mounted consumer', async () => {
			const { selectFirst, select, expectPhase } = setup()
			const consumer = derivedAtom(select, () => {})
			const trigger = primitiveAtom(0, {
				onMount: (_peek, send) => {
					send(selectFirst, false)
				},
			})
			const store = createStore()
			const unsubscribe = store.subscribe(consumer, () => {})
			await flushMicrotask()
			expectPhase('initial')
			const unsubscribeTrigger = store.subscribe(trigger, () => {})
			await flushMicrotask()
			expectPhase('swapped')
			unsubscribeTrigger()
			unsubscribe()
			expectPhase('released')
		})

		it('re-runs consumers before guarded dependencies', async () => {
			const items = primitiveAtom([{ name: 'a' }])
			const index = primitiveAtom(0)
			const valid = primitiveAtom(true)
			const releaseDetail = vi.fn()
			const detailGetter = vi.fn((read: Read) => read(items)[read(index)]?.name)
			const detail = derivedAtom(detailGetter, () => {}, {
				effect: () => releaseDetail,
			})
			const outer = derivedAtom(
				(read) => (read(valid) ? read(detail) : null),
				() => {},
			)
			const store = createStore()
			const unsubscribe = store.subscribe(outer, () => {})
			await flushMicrotask()
			expect(detailGetter).toHaveBeenCalledOnce()
			store.send(index, 3)
			store.send(valid, false)
			await flushMicrotask()
			expect(detailGetter).toHaveBeenCalledOnce()
			expect(releaseDetail).toHaveBeenCalledOnce()
			expect(store.peek(outer)).toBeNull()
			unsubscribe()
		})

		it('reconciles mounted derivations only, keeping unmounted ones lazy', async () => {
			const base = primitiveAtom(1)
			const getter = vi.fn((read: Read) => read(base) * 2)
			const lazy = derivedAtom(getter, () => {})
			const store = createStore()
			expect(store.peek(lazy)).toBe(2)
			expect(getter).toHaveBeenCalledOnce()
			store.send(base, 2)
			await flushMicrotask()
			expect(getter).toHaveBeenCalledOnce()
			expect(store.peek(lazy)).toBe(4)
			expect(getter).toHaveBeenCalledTimes(2)
		})
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
		const notifyAgain = vi.fn()
		remount = () => {
			remount = () => {}
			unsubscribeAgain = store.subscribe(consumer, notifyAgain)
		}
		await flushMicrotask()
		unsubscribe()
		await flushMicrotask()
		expect(sourceEffect).toHaveBeenCalledOnce()
		store.send(source, 7)
		await flushMicrotask()
		expect(notifyAgain).toHaveBeenCalledOnce()
		expect(store.peek(consumer)).toBe(7)
		expect(sourceEffect).toHaveBeenCalledTimes(2)
		expect(cleanup).toHaveBeenCalledOnce()
		unsubscribeAgain()
		expect(sourceEffect).toHaveBeenCalledTimes(2)
		expect(cleanup).toHaveBeenCalledTimes(2)
	})

	it('counts a nested subscribe made while an unmounted instance is being retained', async () => {
		const flag = primitiveAtom(true)
		const nestedSubscribe = vi.fn()
		const evaluate = vi.fn()
		const inner = primitiveAtom(5, {
			onMount: () => () => {
				store.subscribe(derived, () => {})
				nestedSubscribe()
			},
		})
		const middle = derivedAtom((read) => {
			evaluate()
			return read(flag) ? read(inner) : 0
		})
		const derived = derivedAtom((read) => {
			evaluate()
			return read(middle) + 1
		})
		const store = createStore()
		store.peek(derived)
		let subscribed = false
		store.subscribe(middle, () => {
			if (subscribed) return
			subscribed = true
			store.subscribe(derived, () => {})
		})
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()
		expect(nestedSubscribe).toHaveBeenCalledOnce()
		expect(mountCount(store, derived)).toBe(2)
		expect(evaluate).toHaveBeenCalledTimes(4)
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

	it('matches family members with the eq function', () => {
		const create = vi.fn((key: string[]) => primitiveAtom(key.join()))
		const lists = atomFamily(create, { eq: shallowEqual })
		const store = createStore()

		expect(store.peek(lists, ['a', 'b'])).toBe('a,b')
		expect(store.peek(lists, ['a', 'b'])).toBe('a,b')
		expect(store.peek(lists, ['b', 'a'])).toBe('b,a')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('returns the first eq match', () => {
		const create = vi.fn((key: { n: number }) => primitiveAtom(key.n))
		const family = atomFamily(create, {
			eq: (a, b) => Math.abs(a.n - b.n) <= 5,
		})
		const store = createStore()

		expect(store.peek(family, { n: 10 })).toBe(10)
		expect(store.peek(family, { n: 20 })).toBe(20)
		expect(store.peek(family, { n: 15 })).toBe(10)
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('rejects hash together with eq', () => {
		expect(() =>
			atomFamily((key: string[]) => primitiveAtom(key.length), {
				hash: (key: string[]) => key.join(),
				// @ts-expect-error hash and eq are mutually exclusive
				eq: shallowEqual,
			}),
		).toThrow('atomFamily accepts either hash or eq, not both')
	})

	it.each<
		[
			string,
			{ TTL: typeof TRANSIENT } | undefined,
			string,
			(
				store: ReturnType<typeof createStore>,
				family: AtomFamily<number, string, [SetStateWithReset<number>]>,
				shared: ReturnType<typeof primitiveAtom<number>>,
			) => void | Promise<void>,
		]
	>([
		[
			'a create factory that returns the same symbol for different keys',
			undefined,
			'second',
			(store, family) => {
				expect(store.peek(family, 'first')).toBe(0)
			},
		],
		[
			'a create factory that returns an already used symbol after eviction',
			undefined,
			'first',
			async (store, family) => {
				expect(store.peek(family, 'first')).toBe(0)
				await flushMicrotask()
			},
		],
		[
			'a transient create factory that returns an already used symbol',
			{ TTL: TRANSIENT },
			'first',
			(store, family) => {
				expect(store.peek(family, 'first')).toBe(0)
			},
		],
		[
			'a create factory that returns a symbol already used directly',
			undefined,
			'first',
			(store, _family, shared) => {
				store.peek(shared)
			},
		],
	])('rejects %s', async (_label, options, key, step) => {
		const shared = primitiveAtom(0)
		const family = atomFamily((_key: string) => shared, options)
		const store = createStore()

		await step(store, family, shared)
		expect(() => store.peek(family, key)).toThrow(
			'atomFamily create must return a fresh symbol on every call',
		)
	})

	it('caches resolved atom handles per store', () => {
		const atom = primitiveAtom(0)
		const store = createStore()

		expect(store.resolve(atom)).toBe(store.resolve(atom))
		expect(createStore().resolve(atom)).not.toBe(store.resolve(atom))
	})

	it('creates a distinct handle and instance for each transient resolve', async () => {
		const { names, store, handle } = keptHandle(TRANSIENT)
		const other = store.resolve(names, 'first')

		expect(other).not.toBe(handle)
		handle.send('updated')
		await flushMicrotask()
		expect(handle.peek()).toBe('updated')
		expect(other.peek()).toBe('first')
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
	})

	it('sends and peeks through a kept handle after TTL 0 eviction', async () => {
		const { create, names, store, handle } = keptHandle()

		handle.subscribe(() => {})()
		await flushMicrotask()
		handle.send('replaced')
		await flushMicrotask()

		expect(create).toHaveBeenCalledTimes(2)
		expect(store.peek(names, 'first')).toBe('replaced')
		expect(handle.peek()).toBe('replaced')
	})

	it('sends and peeks through a kept handle after positive TTL eviction', async () => {
		vi.useFakeTimers()
		const { create, names, store, handle } = keptHandle(100)

		handle.subscribe(() => {})()
		await flushMicrotask()
		vi.advanceTimersByTime(100)
		handle.send('replaced')
		await flushMicrotask()

		expect(create).toHaveBeenCalledTimes(2)
		expect(store.peek(names, 'first')).toBe('replaced')
		expect(handle.peek()).toBe('replaced')
	})

	it('retains and releases the replacement entry when subscribing through a kept handle', async () => {
		const { create, names, store, handle } = keptHandle()
		const notify = vi.fn()

		handle.subscribe(() => {})()
		await flushMicrotask()
		const unsubscribe = handle.subscribe(notify)
		await flushMicrotask()
		store.send(names, 'first', 'updated')
		await flushMicrotask()

		expect(create).toHaveBeenCalledTimes(2)
		expect(store.peek(names, 'first')).toBe('updated')
		expect(notify).toHaveBeenCalledOnce()

		unsubscribe()
		await flushMicrotask()
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledTimes(3)
	})

	it('keeps TTL-negative handles pinned to their instance', async () => {
		const { create, names, store, handle } = keptHandle(TRANSIENT)

		handle.send('pinned')
		await flushMicrotask()
		handle.subscribe(() => {})()
		await flushMicrotask()

		expect(handle.peek()).toBe('pinned')
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('recomputes a derived atom after its family member is replaced', async () => {
		const names = atomFamily((key: string) => primitiveAtom(key))
		const upper = derivedAtom((read) => read(names, 'first').toUpperCase())
		const store = createStore()

		store.subscribe(upper, () => {})()
		await flushMicrotask()
		store.send(names, 'first', 'replaced')
		await flushMicrotask()
		const unsubscribe = store.subscribe(upper, () => {})

		expect(store.peek(upper)).toBe('REPLACED')
		unsubscribe()
	})

	it('does not link an unmounted evicted member to its dependencies', async () => {
		const base = primitiveAtom(1)
		const getter = vi.fn((read: Read) => read(base) * 2)
		let member: AtomSymbol<number, never> | undefined
		const doubles = atomFamily((_key: string) => {
			member = derivedAtom(getter)
			return member
		})
		const store = createStore()

		store.subscribe(doubles, 'first', () => {})()
		await flushMicrotask()

		expect(mountedSubCount(store, base)).toBe(0)
		expect(getter).toHaveBeenCalledOnce()
		store.send(base, 5)
		await flushMicrotask()
		assert(member)
		expect(store.peek(member)).toBe(10)
		expect(getter).toHaveBeenCalledTimes(2)
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

	it.each(['cleanup', 'dependency setup'] as const)(
		'waits for a remounted consumer before setup when %s changes its lifecycle',
		async (phase) => {
			const events: string[] = []
			const store = createStore()
			let unsubscribe = () => {}
			let remounted = false
			const remount = () => {
				if (remounted) return
				remounted = true
				unsubscribe()
				unsubscribe = store.subscribe(consumer, () => {})
			}
			const source = primitiveAtom(0, {
				effect: (next) => {
					if (next === 1 && phase === 'dependency setup') remount()
				},
			})
			const consumer = derivedAtom((read) => read(source), undefined, {
				onMount: () => {
					events.push('mount')
					return () => events.push('unmount')
				},
				effect: (next, last) => {
					events.push(`setup:${last}->${next}`)
					return () => {
						events.push(`cleanup:${next}`)
						if (phase === 'cleanup') remount()
					}
				},
			})
			const unsubscribeSource = store.subscribe(source, () => {})
			unsubscribe = store.subscribe(consumer, () => {})
			await flushMicrotask()
			events.length = 0

			store.send(source, 1)
			await flushMicrotask()
			await flushMicrotask()

			expect(events).toEqual([
				'cleanup:0',
				'unmount',
				'mount',
				'setup:undefined->1',
			])
			events.length = 0
			unsubscribe()
			unsubscribeSource()
			expect(events).toEqual(['cleanup:1', 'unmount'])
		},
	)

	it('defers initial setup if a dependency effect remounts its consumer', async () => {
		const events: string[] = []
		const store = createStore()
		let unsubscribe = () => {}
		const source = primitiveAtom(0, {
			effect: () => {
				unsubscribe()
				unsubscribe = store.subscribe(consumer, () => {})
			},
		})
		const consumer = derivedAtom((read) => read(source), undefined, {
			onMount: () => {
				events.push('mount')
				return () => events.push('unmount')
			},
			effect: () => {
				events.push('setup')
				return () => events.push('cleanup')
			},
		})
		const unsubscribeSource = store.subscribe(source, () => {})
		unsubscribe = store.subscribe(consumer, () => {})

		await flushMicrotask()
		await flushMicrotask()

		expect(events).toEqual(['mount', 'unmount', 'mount', 'setup'])
		unsubscribe()
		unsubscribeSource()
		expect(events).toEqual([
			'mount',
			'unmount',
			'mount',
			'setup',
			'cleanup',
			'unmount',
		])
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
	it('delivers only the settled value once when onMount writes several dependencies', async () => {
		const a = primitiveAtom(0)
		const b = primitiveAtom(0)
		const sum = derivedAtom((read) => read(a) + read(b), undefined, {
			onMount: (_get, set) => {
				set(a, 1)
				set(b, 2)
			},
		})
		const store = createStore()
		const seen: number[] = []
		store.subscribe(sum, () => seen.push(store.peek(sum)))
		await flushMicrotask()

		expect(seen).toEqual([3])
	})

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

describe.each([
	{ mode: 'hash', lookup: { hash: (key: string[]) => key.join() } },
	{ mode: 'eq', lookup: { eq: shallowEqual } },
] as const)('array-keyed family with $mode lookup', ({ lookup }) => {
	const makeFamily = (opts: Pick<AtomFamilyOptions<string[]>, 'TTL'> = {}) => {
		const create = vi.fn((key: string[]) => primitiveAtom(key.join()))
		return { create, family: atomFamily(create, { ...opts, ...lookup }) }
	}

	afterEach(() => vi.useRealTimers())

	it.each([0, 100, Infinity])(
		'caches resolved family handles with TTL %s',
		(TTL) => {
			const { create, family } = makeFamily({ TTL })
			const store = createStore()
			const first = ['a']
			const handle = store.resolve(family, first)

			expect(store.resolve(family, ['a'])).toBe(handle)
			expect(handle.peek()).toBe('a')
			expect(create).toHaveBeenCalledExactlyOnceWith(first)
			expect(store.resolve(family, ['b'])).not.toBe(handle)
		},
	)

	it('evicts only the expired family member', async () => {
		const { create, family } = makeFamily()
		const store = createStore()
		const kept = store.resolve(family, ['kept'])
		const unsubscribe = kept.subscribe(() => {})
		store.peek(family, ['dropped'])
		await flushMicrotask()

		expect(store.resolve(family, ['kept'])).toBe(kept)
		store.peek(family, ['dropped'])
		expect(create).toHaveBeenCalledTimes(3)
		unsubscribe()
	})

	it.each([0, 100])(
		'replaces resolved handles after TTL %s eviction while old handles stay usable',
		async (TTL) => {
			vi.useFakeTimers()
			const { family } = makeFamily({ TTL })
			const store = createStore()
			const handle = store.resolve(family, ['a'])
			handle.subscribe(() => {})()
			await flushMicrotask()
			vi.advanceTimersByTime(TTL)

			const replacement = store.resolve(family, ['a'])
			expect(replacement).not.toBe(handle)
			expect(store.resolve(family, ['a'])).toBe(replacement)
			const notify = vi.fn()
			const unsubscribe = handle.subscribe(notify)
			handle.send('updated')
			await flushMicrotask()

			expect(replacement.peek()).toBe('updated')
			expect(handle.peek()).toBe('updated')
			expect(notify).toHaveBeenCalledOnce()
			unsubscribe()
		},
	)

	it('hydrates family members', () => {
		const { family } = makeFamily({ TTL: Infinity })
		const store = createStore([hydrate(family, ['a'], 'hydrated')])

		expect(store.peek(family, ['a'])).toBe('hydrated')
		expect(store.peek(family, ['b'])).toBe('b')
	})
})

describe('family eviction', () => {
	afterEach(() => vi.useRealTimers())

	it.each([0, 100, Infinity])(
		'expires peek-only entries according to TTL %s',
		async (TTL) => {
			vi.useFakeTimers()
			const { create, names, store } = keptHandle(TTL)
			store.peek(names, 'first')
			await flushMicrotask()
			if (TTL > 0 && TTL < Infinity) {
				vi.advanceTimersByTime(TTL - 1)
				store.peek(names, 'first')
				expect(create).toHaveBeenCalledOnce()
				vi.advanceTimersByTime(1)
			}
			store.peek(names, 'first')
			expect(create).toHaveBeenCalledTimes(TTL === Infinity ? 1 : 2)
		},
	)

	it('evicts an unmounted dependency without recomputing until its next read', async () => {
		const create = vi.fn((_key: string) => primitiveAtom(1))
		const family = atomFamily(create)
		const getter = vi.fn((read: Read) => read(family, 'a') * 2)
		const double = derivedAtom(getter)
		const store = createStore()
		expect(store.peek(double)).toBe(2)
		await flushMicrotask()
		await flushMicrotask()
		expect(create).toHaveBeenCalledOnce()
		expect(getter).toHaveBeenCalledOnce()
		expect(store.peek(double)).toBe(2)
		expect(create).toHaveBeenCalledTimes(2)
		expect(getter).toHaveBeenCalledTimes(2)
	})

	it('retains a peeked entry subscribed before the flush and evicts on release', async () => {
		const { create, names, store } = keptHandle()
		store.peek(names, 'first')
		const release = store.subscribe(names, 'first', () => {})
		await flushMicrotask()
		expect(create).toHaveBeenCalledOnce()
		release()
		await flushMicrotask()
		store.peek(names, 'first')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it.each(['primitive', 'readable', 'write-only'] as const)(
		'applies write retention to %s members',
		async (kind) => {
			const values = atomFamily((_key: string) => primitiveAtom(0))
			const create = vi.fn((_key: string) =>
				kind === 'primitive'
					? primitiveAtom(0)
					: derivedAtom(
							kind === 'readable' ? (read: Read) => read(values, 'a') : null,
							(_read, write, value: SetStateWithReset<number>) =>
								write(values, 'a', value),
						),
			)
			const family = atomFamily(create)
			const store = createStore()
			store.send(family, 'a', 7)
			await flushMicrotask()
			if (kind === 'primitive' || kind === 'readable') {
				expect(store.peek(family, 'a')).toBe(7)
				expect(create).toHaveBeenCalledOnce()
			} else {
				expect(store.peek(values, 'a')).toBe(7)
				store.resolve(family, 'a')
				expect(create).toHaveBeenCalledTimes(2)
			}
		},
	)

	it('keeps hydrated primitives and evicts hydrated write-only members in the constructor', () => {
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const create = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: number) =>
				write(values, 'a', value),
			),
		)
		const commands = atomFamily(create)
		const store = createStore([
			[values, 'b', 5],
			[commands, 'a', 7],
		])
		expect(store.peek(values, 'a')).toBe(7)
		expect(store.peek(values, 'b')).toBe(5)
		store.resolve(commands, 'a')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('evicts entries created during a flush in the following flush', async () => {
		const store = createStore()
		const ephemeralCreate = vi.fn((_key: string) => primitiveAtom(0))
		const ephemeral = atomFamily(ephemeralCreate)
		const trigger = primitiveAtom(0, {
			effect: () => {
				store.peek(ephemeral, 'a')
			},
		})
		const release = store.subscribe(trigger, () => {})
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledOnce()
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledTimes(2)
		release()
	})

	it.each(['direct', 'effect', 'onMount', 'command'] as const)(
		'keeps a released TTL-0 entry written by %s',
		async (source) => {
			const { create, names, store } = keptHandle()
			const release = store.subscribe(names, 'first', () => {})
			await flushMicrotask()
			release()
			const write = () => store.send(names, 'first', 'saved')
			let releaseTrigger: (() => void) | undefined
			if (source === 'direct') write()
			else if (source === 'command') store.send(derivedAtom(null, write))
			else {
				const trigger = primitiveAtom(
					0,
					source === 'effect' ? { effect: write } : { onMount: write },
				)
				releaseTrigger = store.subscribe(trigger, () => {})
			}
			await flushMicrotask()
			await flushMicrotask()
			expect(store.peek(names, 'first')).toBe('saved')
			expect(create).toHaveBeenCalledOnce()
			releaseTrigger?.()
		},
	)

	it('cancels a positive TTL timeout on write and evicts after a later mount cycle', async () => {
		vi.useFakeTimers()
		const { create, names, store } = keptHandle(100)
		store.subscribe(names, 'first', () => {})()
		await flushMicrotask()
		vi.advanceTimersByTime(50)
		store.send(names, 'first', 'saved')
		await flushMicrotask()
		vi.advanceTimersByTime(100)
		expect(store.peek(names, 'first')).toBe('saved')
		expect(create).toHaveBeenCalledOnce()
		store.subscribe(names, 'first', () => {})()
		await flushMicrotask()
		vi.advanceTimersByTime(100)
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('does not let writes before release or subsequent peeks cancel eviction', async () => {
		const { create, names, store } = keptHandle()
		const release = store.subscribe(names, 'first', () => {})
		store.send(names, 'first', 'lost')
		release()
		store.peek(names, 'first')
		await flushMicrotask()
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('evicts normally after a canceled TTL-0 eviction and a new mount cycle', async () => {
		const { create, names, store } = keptHandle()
		store.subscribe(names, 'first', () => {})()
		store.send(names, 'first', 'saved')
		await flushMicrotask()
		expect(store.peek(names, 'first')).toBe('saved')
		store.subscribe(names, 'first', () => {})()
		await flushMicrotask()
		expect(store.peek(names, 'first')).toBe('first')
		expect(create).toHaveBeenCalledTimes(2)
	})
})

describe('command family eviction', () => {
	it('evicts command members while retaining the primitive family entries they write', async () => {
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const commands = createCommands<{ save: (value: number) => void }>()
		const create = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: number) =>
				write(commands.cmd.save, value),
			),
		)
		const family = atomFamily(create)
		const store = createStore()
		store.send(commands.dependencyAtom, {
			save: (value) => store.send(values, 'a', value),
		})
		await flushMicrotask()
		store.send(family, 'a', 7)
		await flushMicrotask()
		expect(store.peek(values, 'a')).toBe(7)
		store.resolve(family, 'a')
		expect(create).toHaveBeenCalledTimes(2)
	})
})

describe('unmounted derived caches', () => {
	const transientDerived = (
		source: AtomSymbol<number, [SetStateWithReset<number>]>,
		created: AtomSymbol<number, never>[],
	) =>
		atomFamily(
			(key: number) => {
				const symbol = derivedAtom((read) => read(source) + key)
				created.push(symbol)
				return symbol
			},
			{ TTL: TRANSIENT },
		)

	type Access = (
		store: ReturnType<typeof createStore>,
		family: ReturnType<typeof transientDerived>,
		key: number,
	) => number

	it.each<[string, Access]>([
		[
			'subscribe',
			(store, family, key) => {
				const handle = store.resolve(family, key)
				const value = handle.peek()
				handle.subscribe(() => {})()
				return value
			},
		],
		['resolve peek', (store, family, key) => store.resolve(family, key).peek()],
		['family peek', (store, family, key) => store.peek(family, key)],
	])('detaches transient dependants after %s churn', async (_name, access) => {
		const source = primitiveAtom(1)
		const created: AtomSymbol<number, never>[] = []
		const family = transientDerived(source, created)
		const store = createStore()
		for (let key = 0; key < 100; key++)
			expect(access(store, family, key)).toBe(1 + key)
		await flushMicrotask()
		const dependants = new Set<object>(
			created.map((symbol) => internalInstance(store, symbol)),
		)
		expect(dependants.size).toBe(100)
		for (const dependant of dependants) expect(dependant).toBeDefined()
		expect(mountedSubCount(store, source)).toBe(0)
		expectNoStrongReferences(store, source, dependants)
	})

	it.each([false, true])(
		'does not retain discarded ordinary derivations (subscribe: %s)',
		async (subscribe) => {
			const source = primitiveAtom(1)
			const store = createStore()
			const dependants = new Set<object>()
			for (let key = 0; key < 100; key++) {
				const derived = derivedAtom((read) => read(source) + key)
				expect(store.peek(derived)).toBe(1 + key)
				dependants.add(internalInstance(store, derived))
				if (subscribe) store.subscribe(derived, () => {})()
			}
			await flushMicrotask()
			expect(dependants.size).toBe(100)
			expect(mountedSubCount(store, source)).toBe(0)
			expectNoStrongReferences(store, source, dependants)
		},
	)

	it('keeps dependant links only while mounted', async () => {
		const source = primitiveAtom(1)
		const derived = derivedAtom((read) => read(source) * 2)
		const store = createStore()
		const unsubscribe = store.subscribe(derived, () => {})
		await flushMicrotask()
		expect(mountedSubCount(store, source)).toBe(1)
		unsubscribe()
		expect(mountedSubCount(store, source)).toBe(0)
	})

	it('returns fresh values from a retained unmounted handle after its source changes', async () => {
		const source = primitiveAtom(1)
		const getter = vi.fn((read: Read) => read(source) * 2)
		const family = atomFamily(() => derivedAtom(getter), { TTL: TRANSIENT })
		const store = createStore()
		const handle = store.resolve(family, 'a')
		expect(handle.peek()).toBe(2)
		expect(handle.peek()).toBe(2)
		expect(getter).toHaveBeenCalledTimes(1)
		store.send(source, 5)
		await flushMicrotask()
		expect(handle.peek()).toBe(10)
		expect(getter).toHaveBeenCalledTimes(2)
	})

	it('refreshes a stale unmounted cache when it is subscribed again', async () => {
		const source = primitiveAtom(1)
		const derived = derivedAtom((read) => read(source) * 2)
		const store = createStore()
		const notify = vi.fn()
		store.subscribe(derived, () => {})()
		store.send(source, 4)
		await flushMicrotask()
		store.subscribe(derived, notify)
		await flushMicrotask()
		expect(store.peek(derived)).toBe(8)
		store.send(source, 5)
		await flushMicrotask()
		expect(notify).toHaveBeenCalledTimes(1)
		expect(store.peek(derived)).toBe(10)
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
		const initial = store.peek(top)
		const derivedCount = depth * width
		expect(evaluate).toHaveBeenCalledTimes(derivedCount)
		const depsAreCurrent = vi.spyOn(store as any, 'depsAreCurrent')
		expect(store.peek(top)).toBe(initial)
		expect(store.peek(top)).toBe(initial)
		expect(depsAreCurrent).not.toHaveBeenCalled()
		expect(evaluate).toHaveBeenCalledTimes(derivedCount)
		store.send(leaf, 2)
		await flushMicrotask()
		expect(store.peek(top)).toBe(2 * initial)
		expect(evaluate).toHaveBeenCalledTimes(2 * derivedCount)
		expect(depsAreCurrent.mock.calls.length).toBeLessThanOrEqual(
			derivedCount + 1,
		)
	})

	it('recomputes unmounted dependants of an evicted family member', async () => {
		const members = atomFamily((_key: string) => primitiveAtom(0))
		const derived = derivedAtom((read) => read(members, 'a'))
		const store = createStore()
		expect(store.peek(derived)).toBe(0)
		await flushMicrotask()
		store.send(members, 'a', 3)
		await flushMicrotask()
		expect(store.peek(derived)).toBe(3)
	})
})
