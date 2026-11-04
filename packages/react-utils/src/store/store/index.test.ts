import { assert, describe, expect, it, type Mock, vi } from 'vitest'

import {
	derivedAtom,
	atomFamily,
	hydrate,
	primitiveAtom,
	TRANSIENT,
	type AtomSymbol,
	type Read,
	type Store,
} from '.'
import { isoAssert, type SetStateWithReset } from '../../functions'
import { createCommands } from '../commandAtoms'
import {
	consumerCount,
	createStore,
	flushMicrotask,
	inspect,
} from './utils.testing'

const internalInstance = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => {
	const instance = inspect(store).instances.get(symbol as AtomSymbol<any, any>)
	isoAssert(instance)
	return instance
}

const mountedSubCount = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => consumerCount(internalInstance(store, symbol))

const mountCount = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => internalInstance(store, symbol).mountCount

const readClosure = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => {
	const lifecycle = internalInstance(store, symbol).effectLifecycle
	assert(lifecycle)
	return lifecycle.readClosure
}

const expectNoStrongReferences = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
	dependants: Set<object>,
) => {
	const source: object = internalInstance(store, symbol)
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

	it('settles a diamond once per batch', async () => {
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
		const other = primitiveAtom(0)
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
		const sum = derivedAtom((read) => read(source) + read(other))
		const store = createStore()
		const leafSeen: number[] = []
		const sumSeen: number[] = []
		store.subscribe(leaf, () => leafSeen.push(store.peek(leaf)))
		store.subscribe(sum, () => sumSeen.push(store.peek(sum)))
		await flushMicrotask()
		events.length = 0

		store.send(source, 1)
		store.send(source, 2)
		store.send(other, 5)
		await flushMicrotask()

		expect(leafSeen).toEqual([7])
		expect(sumSeen).toEqual([7])
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
			await flushMicrotask()
			expect(effect).toHaveBeenCalledOnce()
			expect(effect.mock.calls[0]).toEqual([
				undefined,
				undefined,
				expect.any(Function),
				expect.any(Function),
			])
			store.send(atom, 1)
			await flushMicrotask()
			store.send(atom, undefined)
			await flushMicrotask()
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
			await flushMicrotask()
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

	const remounting = (hooks: {
		source?: (next: number, remount: () => void) => void
		cleanup?: (remount: () => void) => void
	}) => {
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
			effect: (next) => hooks.source?.(next, remount),
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
					hooks.cleanup?.(remount)
				}
			},
		})
		const unsubscribeSource = store.subscribe(source, () => {})
		unsubscribe = store.subscribe(consumer, () => {})
		return {
			events,
			store,
			source,
			release: () => {
				unsubscribe()
				unsubscribeSource()
			},
		}
	}

	const updatedTwice = [
		'mount',
		'setup:undefined->0',
		'cleanup:0',
		'unmount',
		'mount',
		'setup:undefined->1',
		'cleanup:1',
		'unmount',
	]

	it('defers initial setup if a dependency effect remounts its consumer', async () => {
		const { events, release } = remounting({
			source: (_next, remount) => remount(),
		})
		await flushMicrotask()
		await flushMicrotask()
		release()

		expect(events).toEqual([
			'mount',
			'unmount',
			'mount',
			'setup:undefined->0',
			'cleanup:0',
			'unmount',
		])
	})

	it('waits for a remounted consumer before setup when its cleanup remounts it', async () => {
		const { events, store, source, release } = remounting({
			cleanup: (remount) => remount(),
		})
		await flushMicrotask()
		store.send(source, 1)
		await flushMicrotask()
		await flushMicrotask()
		release()

		expect(events).toEqual(updatedTwice)
	})

	it('waits for a remounted consumer before setup when a dependency setup remounts it', async () => {
		const { events, store, source, release } = remounting({
			source: (next, remount) => {
				if (next === 1) remount()
			},
		})
		await flushMicrotask()
		store.send(source, 1)
		await flushMicrotask()
		await flushMicrotask()
		release()

		expect(events).toEqual(updatedTwice)
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

	describe('transitive mount order within a flush', () => {
		const logMount = (order: string[], name: string) => ({
			onMount: () => {
				order.push(name)
			},
		})
		const fixture = (order: string[]) => {
			const flag = primitiveAtom(false)
			const sw = primitiveAtom(false)
			const e = primitiveAtom(1, logMount(order, 'E'))
			const b = primitiveAtom(0, {
				onMount: (_get, set) => {
					order.push('B')
					set(flag, true)
				},
			})
			const m = derivedAtom((get) => (get(flag) ? get(e) : 0))
			const m2 = derivedAtom((get) => (get(sw) ? get(b) : 0))
			return { flag, sw, e, b, m, m2 }
		}
		type Atoms = ReturnType<typeof fixture>
		it.each<{
			name: string
			read: (get: Read, atoms: Atoms) => number
		}>([
			{
				name: 'a mounted intermediate gains the dependency',
				read: (get, { sw, b, m }) => (get(sw) ? get(b) : 0) + get(m),
			},
			{
				name: 'the consumer itself gains the dependency',
				read: (get, { sw, b, flag, e }) =>
					(get(sw) ? get(b) : 0) + (get(flag) ? get(e) : 0),
			},
			{
				name: 'the writer is reached through a mounted intermediate without onMount',
				read: (get, { m2, flag, e }) => (get(flag) ? get(e) : 0) + get(m2),
			},
			{
				name: 'a mounted intermediate is walked before the writer',
				read: (get, { sw, b, m }) => get(m) + (get(sw) ? get(b) : 0),
			},
		])('mounts the new dependency first when $name', async ({ read }) => {
			const order: string[] = []
			const atoms = fixture(order)
			const a = derivedAtom(
				(get) => read(get, atoms),
				undefined,
				logMount(order, 'A'),
			)
			const store = createStore()
			store.subscribe(atoms.m, () => {})
			store.subscribe(atoms.m2, () => {})
			await flushMicrotask()
			store.subscribe(a, () => {})
			store.send(atoms.sw, true)
			await flushMicrotask()

			expect(order).toEqual(['B', 'E', 'A'])
		})

		it('does not mount a sibling that an onMount write unlinked', async () => {
			const order: string[] = []
			const flag = primitiveAtom(false)
			const keep = primitiveAtom(true)
			const sw = primitiveAtom(false)
			const a = primitiveAtom(1, {
				onMount: (_get, set) => {
					order.push('A')
					set(keep, false)
				},
			})
			const b = primitiveAtom(2, {
				onMount: () => {
					order.push('B')
					return () => {
						order.push('~B')
					}
				},
			})
			const i = derivedAtom(
				(get) => (get(flag) ? get(a) + (get(keep) ? get(b) : 0) : 0),
				undefined,
				logMount(order, 'I'),
			)
			const c = derivedAtom(
				(get) => (get(sw) ? get(i) : 0),
				undefined,
				logMount(order, 'C'),
			)
			const store = createStore()
			store.subscribe(c, () => {})
			store.send(flag, true)
			store.send(sw, true)
			await flushMicrotask()
			await flushMicrotask()

			expect(order).toEqual(['A', 'I', 'C'])
		})

		it('mounts a dependency gained through an unmounted intermediate before the consumer', async () => {
			const order: string[] = []
			const flag = primitiveAtom(false)
			const sw = primitiveAtom(false)
			const g = primitiveAtom(1, {
				onMount: (_get, set) => {
					order.push('G')
					set(flag, true)
				},
			})
			const i = derivedAtom((get) => get(g), undefined, logMount(order, 'I'))
			const e = primitiveAtom(1, logMount(order, 'E'))
			const c = derivedAtom(
				(get) => (get(sw) ? get(i) : 0) + (get(flag) ? get(e) : 0),
				undefined,
				logMount(order, 'C'),
			)
			const store = createStore()
			store.subscribe(c, () => {})
			store.send(sw, true)
			await flushMicrotask()
			await flushMicrotask()

			expect(order).toEqual(['G', 'I', 'E', 'C'])
		})

		it('remounts a node torn down and requeued by user code during its own walk', async () => {
			const order: string[] = []
			const sw = primitiveAtom(false)
			let unsubscribeN = () => {}
			let unsubscribeP = () => {}
			let tornDown = false
			const store = createStore()
			const d = primitiveAtom(1, {
				onMount: () => {
					order.push('D')
					if (tornDown) return
					tornDown = true
					unsubscribeN()
					unsubscribeP()
					unsubscribeP = store.subscribe(p, () => {})
					return () => {
						order.push('~D')
					}
				},
			})
			const n = derivedAtom((get) => (get(sw) ? get(d) : 0), undefined, {
				onMount: () => {
					order.push('N')
					return () => {
						order.push('~N')
					}
				},
			})
			const p = derivedAtom((get) => get(n), undefined, logMount(order, 'P'))
			unsubscribeN = store.subscribe(n, () => {})
			await flushMicrotask()
			unsubscribeP = store.subscribe(p, () => {})
			store.send(sw, true)
			await flushMicrotask()

			expect(order).toEqual(['N', 'D', '~N', '~D', 'D', 'N', 'P'])
		})

		it('mounts the parent after a sibling torn down and requeued without a write', async () => {
			const order: string[] = []
			let unsubscribeR = () => {}
			let tornDown = false
			const store = createStore()
			const w = primitiveAtom(1, {
				onMount: () => {
					order.push('W')
					return () => {
						order.push('~W')
					}
				},
			})
			const x = primitiveAtom(2, {
				onMount: () => {
					order.push('X')
					if (tornDown) return
					tornDown = true
					unsubscribeR()
					unsubscribeR = store.subscribe(r, () => {})
				},
			})
			const sw = primitiveAtom(false)
			const r = derivedAtom(
				(get) => (get(sw) ? get(w) + get(x) : 0),
				undefined,
				logMount(order, 'R'),
			)
			unsubscribeR = store.subscribe(r, () => {})
			store.send(sw, true)
			store.subscribe(x, () => {})
			await flushMicrotask()

			expect(order).toEqual(['W', 'X', '~W', 'W', 'R'])
		})
	})

	describe('release bookkeeping within a flush', () => {
		const logMountCycle = (events: string[]) => ({
			onMount: () => {
				events.push('mount')
				return () => events.push('unmount')
			},
		})
		const logEffect = (events: string[], name: string) => ({
			effect: () => {
				events.push(`${name} setup`)
				return () => events.push(`${name} cleanup`)
			},
		})
		const effectWithCleanup = { effect: () => () => {} }
		const effectWithoutCleanup = { effect: () => {} }
		const mountWriter = <T>(
			target: ReturnType<typeof primitiveAtom<T>>,
			value: T,
		) =>
			primitiveAtom(0, {
				onMount: (_get, set) => {
					set(target, value)
				},
			})
		const diamond = <Args extends unknown[]>(
			leaf: AtomSymbol<number, Args>,
		) => {
			const sel = primitiveAtom(false)
			const mode = primitiveAtom(false)
			const gated = derivedAtom<number>((get) => (get(sel) ? 0 : get(leaf)))
			const direct = derivedAtom<number>((get) => get(gated))
			const bypass = derivedAtom<number>((get) => get(leaf))
			const joined = derivedAtom<number>((get) => get(gated) + get(bypass))
			const top = derivedAtom<number>((get) =>
				get(mode) ? get(joined) : get(direct),
			)
			return { sel, mode, top }
		}
		const setupThenCleanupOrder = [
			'top setup',
			'resource setup',
			'top cleanup',
			'resource cleanup',
		]

		it('cleans up a late-linked dependency only after the consumer effects that read it', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const mode = primitiveAtom(0)
			const resource = primitiveAtom(0, logEffect(events, 'resource'))
			const middle = derivedAtom<number>(
				(get) => (get(sel) ? get(resource) * 0 : 0),
				undefined,
				logEffect(events, 'middle'),
			)
			const top = derivedAtom<number>(
				(get) => (get(mode) === 0 ? get(middle) : get(mode)),
				undefined,
				logEffect(events, 'top'),
			)
			const store = createStore()
			store.subscribe(top, () => {})
			await flushMicrotask()
			store.send(sel, true)
			await flushMicrotask()
			events.length = 0
			store.send(mode, 1)
			store.send(resource, 5)
			await flushMicrotask()

			expect(events).toEqual([
				'top cleanup',
				'middle cleanup',
				'resource cleanup',
				'top setup',
			])
		})

		it('releases a dependency of a retained dependency that the retaining effect never read', async () => {
			const events: string[] = []
			const sel = primitiveAtom(true)
			const reads = primitiveAtom(false)
			const resource = primitiveAtom(0, logMountCycle(events))
			const middle = derivedAtom<number>((get) =>
				get(reads) ? get(resource) * 0 : 0,
			)
			const inner = derivedAtom<number>((get) => (get(sel) ? get(middle) : 0))
			const top = derivedAtom<number>(
				(get) => get(inner),
				undefined,
				effectWithCleanup,
			)
			const store = createStore()
			store.subscribe(top, () => {})
			await flushMicrotask()
			store.send(sel, false)
			await flushMicrotask()
			store.send(reads, true)
			await flushMicrotask()
			expect(events).toEqual(['mount'])
			store.send(reads, false)
			await flushMicrotask()

			expect(events).toEqual(['mount', 'unmount'])
		})

		it('keeps a dependency mounted when a stale consumer is dropped and another path regains it in the same flush', async () => {
			const events: string[] = []
			const resource = primitiveAtom(0, logMountCycle(events))
			const { sel, mode, top } = diamond(resource)
			const store = createStore()
			store.subscribe(top, () => {})
			await flushMicrotask()
			store.send(sel, true)
			store.send(mode, true)
			await flushMicrotask()

			expect(events).toEqual(['mount'])
		})

		it('keeps a dependency mounted when a mount write regains it after its only stale consumer is dropped', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const trigger = primitiveAtom(false)
			const resource = primitiveAtom(0, logMountCycle(events))
			const writer = mountWriter(trigger, true)
			const gated = derivedAtom<number>((get) => (get(sel) ? 0 : get(resource)))
			const top = derivedAtom<number>((get) => get(gated))
			const regain = derivedAtom<number>((get) =>
				get(trigger) ? get(resource) : 0,
			)
			const store = createStore()
			store.subscribe(top, () => {})
			store.subscribe(regain, () => {})
			await flushMicrotask()
			store.send(sel, true)
			store.subscribe(writer, () => {})
			await flushMicrotask()

			expect(events).toEqual(['mount'])
		})

		it('never mounts a pending subgraph below a dependency dropped by a stale consumer', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const resource = primitiveAtom(0, logMountCycle(events))
			const left = derivedAtom<number>((get) => get(resource))
			const right = derivedAtom<number>((get) => get(resource))
			const leaf = derivedAtom<number>((get) => get(left) + get(right))
			const gated = derivedAtom<number>((get) => (get(sel) ? 0 : get(leaf)))
			const direct = derivedAtom<number>((get) => get(gated))
			const top = derivedAtom<number>((get) => get(direct))
			const store = createStore()
			store.subscribe(top, () => {})
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toEqual([])
		})

		it('keeps a dependency mounted when its live resource sits below a dropped dependency that is not mounted yet', async () => {
			const events: string[] = []
			const resource = primitiveAtom(0, logMountCycle(events))
			const inner = derivedAtom<number>((get) => get(resource))
			const { sel, mode, top } = diamond(inner)
			const store = createStore()
			const releaseResource = store.subscribe(resource, () => {})
			await flushMicrotask()
			store.subscribe(top, () => {})
			releaseResource()
			store.send(sel, true)
			store.send(mode, true)
			await flushMicrotask()

			expect(events).toEqual(['mount'])
		})

		it('defers the cleanup of a resource linked below an effect that did not rerun until that effect is cleaned up', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const resource = primitiveAtom(0, logEffect(events, 'resource'))
			const inner = derivedAtom<number>((get) =>
				get(sel) ? get(resource) * 0 : 0,
			)
			const middle = derivedAtom<number>((get) => get(inner))
			const top = derivedAtom<number>(
				(get) => get(middle),
				undefined,
				logEffect(events, 'top'),
			)
			const store = createStore()
			const unsubscribe = store.subscribe(top, () => {})
			await flushMicrotask()
			store.send(sel, true)
			await flushMicrotask()
			store.send(sel, false)
			await flushMicrotask()
			expect(events).toEqual(['top setup', 'resource setup'])
			unsubscribe()
			await flushMicrotask()

			expect(events).toEqual(setupThenCleanupOrder)
		})

		it('defers the cleanup of a resource linked below a retained orphan once an effect reads the orphan again', async () => {
			const events: string[] = []
			const gate = primitiveAtom(true)
			const sel = primitiveAtom(false)
			const resource = primitiveAtom(0, logEffect(events, 'resource'))
			const middle = derivedAtom<number>((get) =>
				get(sel) ? get(resource) * 0 : 0,
			)
			const top = derivedAtom<number>(
				(get) => (get(gate) ? get(middle) : 0),
				undefined,
				logEffect(events, 'top'),
			)
			const store = createStore()
			const unsubscribe = store.subscribe(top, () => {})
			await flushMicrotask()
			store.send(gate, false)
			await flushMicrotask()
			store.send(sel, true)
			await flushMicrotask()
			store.send(gate, true)
			await flushMicrotask()
			store.send(sel, false)
			await flushMicrotask()
			expect(events).toEqual(['top setup', 'resource setup'])
			unsubscribe()
			await flushMicrotask()

			expect(events).toEqual(setupThenCleanupOrder)
		})

		const linkedAndUnlinkedInOneFlush = async ({
			keepLinkedMounted,
		}: {
			keepLinkedMounted: boolean
		}) => {
			const branch = primitiveAtom(0)
			const fallback = primitiveAtom(5)
			const linked = primitiveAtom(7)
			const writer = mountWriter(branch, 2)
			const top = derivedAtom<number>(
				(get) => (get(branch) === 1 ? get(linked) : get(fallback)),
				undefined,
				effectWithCleanup,
			)
			const store = createStore()
			if (keepLinkedMounted) store.subscribe(linked, () => {})
			store.subscribe(top, () => {})
			await flushMicrotask()
			store.send(branch, 1)
			store.subscribe(writer, () => {})
			await flushMicrotask()
			return { store, branch, linked, top }
		}

		it('releases a dependency linked and unlinked in the same flush without waiting for the live effect above it', async () => {
			const { store, linked } = await linkedAndUnlinkedInOneFlush({
				keepLinkedMounted: false,
			})

			expect(mountCount(store, linked)).toBe(0)
		})

		it('keeps a dependency linked and unlinked in the same flush out of the read closure of the effect above it', async () => {
			const { store, branch, linked, top } = await linkedAndUnlinkedInOneFlush({
				keepLinkedMounted: true,
			})
			const closure = readClosure(store, top)

			expect(closure).toContain(internalInstance(store, branch))
			expect(closure).not.toContain(internalInstance(store, linked))
		})

		it('drops the instances of evicted family members from the read closure of an effect that does not rerun', async () => {
			const key = primitiveAtom('a')
			const created = new Map<
				string,
				ReturnType<typeof primitiveAtom<number>>
			>()
			const members = atomFamily((name: string) => {
				const member = primitiveAtom(name.length)
				created.set(name, member)
				return member
			})
			const top = derivedAtom<number>(
				(get) => (get(members, get(key)) > 0 ? 1 : 0),
				undefined,
				effectWithoutCleanup,
			)
			const store = createStore()
			store.subscribe(top, () => {})
			await flushMicrotask()
			const keys = ['b', 'c', 'd', 'e']
			for (const name of keys) {
				store.send(key, name)
				await flushMicrotask()
			}
			const closure = readClosure(store, top)
			const latest = created.get(keys.at(-1)!)
			assert(latest)

			expect(closure).toContain(internalInstance(store, key))
			expect(closure).toContain(internalInstance(store, latest))
			expect([...closure].filter(({ mountCount }) => mountCount === 0)).toEqual(
				[],
			)
		})
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

		const reversedPair = ({
			onACleanup,
		}: {
			onACleanup?: (pair: {
				store: Store
				b: AtomSymbol<number, never>
			}) => void
		} = {}) => {
			const events: string[] = []
			const choice = primitiveAtom(true)
			let resourceLive = false
			let consumerSawLiveResource = false
			const b: AtomSymbol<number, never> = derivedAtom<number>(
				(read): number => (read(choice) ? 1 : read(a)),
				undefined,
				{
					effect: () => {
						events.push('B setup')
						resourceLive = true
						return () => {
							events.push('B cleanup')
							resourceLive = false
						}
					},
				},
			)
			const a: AtomSymbol<number, never> = derivedAtom<number>(
				(read): number => (read(choice) ? read(b) : 1),
				undefined,
				{
					effect: () => {
						events.push('A setup')
						return () => {
							events.push('A cleanup')
							consumerSawLiveResource = resourceLive
							onACleanup?.({ store, b })
						}
					},
				},
			)
			const store = createStore()
			const releases = {
				B: store.subscribe(b, () => {}),
				A: store.subscribe(a, () => {}),
			}
			return {
				events,
				choice,
				a,
				b,
				store,
				releases,
				consumerSawLiveResource: () => consumerSawLiveResource,
			}
		}

		it.each([
			[['A', 'B'], [false]],
			[['B', 'A'], [false]],
			[
				['A', 'B'],
				[false, true],
			],
			[
				['B', 'A'],
				[false, true],
			],
		] as const)(
			'releases equal-valued reversed dependencies in order %s after choices %s',
			async (order, choices) => {
				const {
					events,
					choice,
					a,
					b,
					store,
					releases,
					consumerSawLiveResource,
				} = reversedPair()
				await flushMicrotask()
				events.length = 0
				for (const value of choices) {
					store.send(choice, value)
					await flushMicrotask()
				}
				expect(events).toEqual([])
				releases[order[0]]()
				expect(events).toEqual([])
				releases[order[1]]()
				expect(events).toEqual(['A cleanup', 'B cleanup'])
				expect(consumerSawLiveResource()).toBe(true)
				expect(mountCount(store, a)).toBe(0)
				expect(mountCount(store, b)).toBe(0)
			},
		)

		it.each([
			['A', 'B'],
			['B', 'A'],
		] as const)(
			'rebuilds the consumer when its cleanup remounts the dependency (%s released before %s)',
			async (first, second) => {
				let releaseAgain = () => {}
				let remounted = false
				const { events, choice, a, b, store, releases } = reversedPair({
					onACleanup: ({ store, b }) => {
						if (remounted) return
						remounted = true
						releaseAgain = store.subscribe(b, () => {})
					},
				})
				await flushMicrotask()
				events.length = 0
				store.send(choice, false)
				await flushMicrotask()
				expect(events).toEqual([])
				releases[first]()
				expect(events).toEqual([])
				releases[second]()
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
				expect(mountCount(store, a)).toBe(0)
				expect(mountCount(store, b)).toBe(0)
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
		await flushMicrotask()
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

	const swappable = () => {
		const events: string[] = []
		const resource = (name: string, value: number) =>
			primitiveAtom(value, {
				onMount: () => {
					events.push(`${name} mount`)
					return () => events.push(`${name} unmount`)
				},
				effect: () => {
					events.push(`${name} setup`)
					return () => events.push(`${name} cleanup`)
				},
			})
		const first = resource('first', 1)
		const second = resource('second', 2)
		const selectFirst = primitiveAtom(true)
		const select = (read: Read) =>
			read(selectFirst) ? read(first) : read(second)
		return { events, selectFirst, select }
	}

	it('swaps resources under a consumer whose effect returns no cleanup', async () => {
		const { events, selectFirst, select } = swappable()
		const consumer = derivedAtom(select, undefined, {
			effect: (value) => {
				events.push(`consumer ${value}`)
			},
		})
		const store = createStore()
		const unsubscribe = store.subscribe(consumer, () => {})
		await flushMicrotask()
		store.send(selectFirst, false)
		await flushMicrotask()
		unsubscribe()
		expect(events).toEqual([
			'first mount',
			'first setup',
			'consumer 1',
			'first cleanup',
			'first unmount',
			'second mount',
			'second setup',
			'consumer 2',
			'second cleanup',
			'second unmount',
		])
	})

	it('keeps reconciling when a later mount write switches a mounted consumer', async () => {
		const { events, selectFirst, select } = swappable()
		const consumer = derivedAtom(select)
		const trigger = primitiveAtom(0, {
			onMount: (_get, set) => {
				set(selectFirst, false)
			},
		})
		const store = createStore()
		const unsubscribe = store.subscribe(consumer, () => {})
		await flushMicrotask()
		expect(events).toEqual(['first mount', 'first setup'])

		const unsubscribeTrigger = store.subscribe(trigger, () => {})
		await flushMicrotask()
		expect(events).toEqual([
			'first mount',
			'first setup',
			'first cleanup',
			'first unmount',
			'second mount',
			'second setup',
		])

		unsubscribeTrigger()
		unsubscribe()
		expect(events.slice(6)).toEqual(['second cleanup', 'second unmount'])
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

	it.each([
		['effect', (write: () => void) => ({ effect: write })],
		['onMount', (write: () => void) => ({ onMount: write })],
	] as const)(
		'keeps a released TTL-0 entry written by %s',
		async (_source, options) => {
			const create = vi.fn((key: string) => primitiveAtom(key))
			const names = atomFamily(create)
			const store = createStore()
			const release = store.subscribe(names, 'first', () => {})
			await flushMicrotask()
			release()
			const trigger = primitiveAtom(
				0,
				options(() => store.send(names, 'first', 'saved')),
			)
			const releaseTrigger = store.subscribe(trigger, () => {})
			await flushMicrotask()
			await flushMicrotask()
			expect(store.peek(names, 'first')).toBe('saved')
			expect(create).toHaveBeenCalledOnce()
			releaseTrigger()
		},
	)

	it('retains a written readable family member', async () => {
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const create = vi.fn((_key: string) =>
			derivedAtom(
				(read: Read) => read(values, 'a'),
				(_read, write, value: SetStateWithReset<number>) =>
					write(values, 'a', value),
			),
		)
		const family = atomFamily(create)
		const store = createStore()
		store.send(family, 'a', 7)
		await flushMicrotask()
		expect(store.peek(family, 'a')).toBe(7)
		expect(create).toHaveBeenCalledOnce()
	})

	it('evicts written write-only members while retaining the primitives they write', async () => {
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const create = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: SetStateWithReset<number>) =>
				write(values, 'a', value),
			),
		)
		const family = atomFamily(create)
		const commands = createCommands<{ save: (value: number) => void }>()
		const createCommand = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: number) =>
				write(commands.cmd.save, value),
			),
		)
		const commandFamily = atomFamily(createCommand)
		const store = createStore()
		store.send(commands.dependencyAtom, {
			save: (value) => store.send(values, 'b', value),
		})
		await flushMicrotask()

		store.send(family, 'a', 7)
		store.send(commandFamily, 'a', 8)
		await flushMicrotask()

		expect(store.peek(values, 'a')).toBe(7)
		expect(store.peek(values, 'b')).toBe(8)
		store.resolve(family, 'a')
		store.resolve(commandFamily, 'a')
		expect(create).toHaveBeenCalledTimes(2)
		expect(createCommand).toHaveBeenCalledTimes(2)
	})

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
		expect(mountedSubCount(store, source)).toBe(0)
		expectNoStrongReferences(store, source, dependants)
	})

	it.each([
		['peeked', () => {}],
		[
			'subscribed and released',
			(store: Store, derived: AtomSymbol<number, never>) =>
				store.subscribe(derived, () => {})(),
		],
	] as const)(
		'does not retain discarded ordinary derivations (%s)',
		async (_name, use) => {
			const source = primitiveAtom(1)
			const store = createStore()
			const dependants = new Set<object>()
			for (let key = 0; key < 100; key++) {
				const derived = derivedAtom((read) => read(source) + key)
				expect(store.peek(derived)).toBe(1 + key)
				dependants.add(internalInstance(store, derived))
				use(store, derived)
			}
			await flushMicrotask()
			expect(dependants.size).toBe(100)
			expect(mountedSubCount(store, source)).toBe(0)
			expectNoStrongReferences(store, source, dependants)
		},
	)

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
		const validations = inspect(store).validations
		expect(store.peek(top)).toBe(initial)
		expect(store.peek(top)).toBe(initial)
		expect(inspect(store).validations).toBe(validations)
		expect(evaluate).toHaveBeenCalledTimes(derivedCount)
		store.send(leaf, 2)
		await flushMicrotask()
		expect(store.peek(top)).toBe(2 * initial)
		expect(evaluate).toHaveBeenCalledTimes(2 * derivedCount)
		expect(inspect(store).validations - validations).toBeLessThanOrEqual(
			derivedCount + 1,
		)
	})
})
