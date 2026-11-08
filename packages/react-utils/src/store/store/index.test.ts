import { assert, describe, expect, it, vi } from 'vitest'

import {
	derivedAtom,
	effectAtom,
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
	countOperations,
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

		it('invalidates a completed walk when a later root relinks a mounted intermediate', async () => {
			const order: string[] = []
			const flag = primitiveAtom(false)
			const dependency = primitiveAtom(1, logMount(order, 'dependency'))
			const middle = derivedAtom((read) => (read(flag) ? read(dependency) : 0))
			const first = derivedAtom(
				(read) => read(middle),
				undefined,
				logMount(order, 'first'),
			)
			const writer = primitiveAtom(0, {
				onMount: (_read, write) => {
					order.push('writer')
					write(flag, true)
				},
			})
			const last = derivedAtom(
				(read) => read(middle) + read(writer),
				undefined,
				logMount(order, 'last'),
			)
			const store = createStore()
			store.subscribe(middle, () => {})
			await flushMicrotask()
			store.subscribe(first, () => {})
			store.subscribe(last, () => {})

			await flushMicrotask()

			expect(order).toEqual(['first', 'writer', 'dependency', 'last'])
		})

		it('mounts reversed dependencies before their new consumer after an onMount write', async () => {
			const order: string[] = []
			const store = createStore()
			const enabled = primitiveAtom(false)
			const reversed = primitiveAtom(false)
			const writer = primitiveAtom(1, {
				onMount: (_read, write) => {
					order.push('writer')
					store.subscribe(middle, () => {})
					write(reversed, true)
				},
			})
			const middle: AtomSymbol<number, never> = derivedAtom(
				(read) => (read(reversed) ? read(root) : read(writer)),
				undefined,
				logMount(order, 'middle'),
			)
			const root: AtomSymbol<number, never> = derivedAtom(
				(read) => (!read(enabled) ? 0 : read(reversed) ? 100 : read(middle)),
				undefined,
				logMount(order, 'root'),
			)
			store.subscribe(root, () => {})
			store.send(enabled, true)

			await flushMicrotask()

			expect(order).toEqual(['writer', 'root', 'middle'])
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

		it('does not mount a sibling unlinked by a write below an intermediate', async () => {
			const order: string[] = []
			const enabled = primitiveAtom(false)
			const keep = primitiveAtom(true)
			const writer = primitiveAtom(1, {
				onMount: (_read, write) => {
					order.push('writer')
					write(keep, false)
				},
			})
			const middle = derivedAtom(
				(read) => read(writer),
				undefined,
				logMount(order, 'middle'),
			)
			const sibling = primitiveAtom(2, logMount(order, 'sibling'))
			const parent = derivedAtom(
				(read) =>
					read(enabled) ? read(middle) + (read(keep) ? read(sibling) : 0) : 0,
				undefined,
				logMount(order, 'parent'),
			)
			const store = createStore()
			store.subscribe(parent, () => {})
			store.send(enabled, true)

			await flushMicrotask()

			expect(order).toEqual(['writer', 'middle', 'parent'])
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

	const swappable = () => {
		const events: string[] = []
		const resource = (name: string, value: number) =>
			primitiveAtom(value, {
				onMount: (_get, _set, mountEffect) => {
					events.push(`${name} mount`)
					mountEffect(
						effectAtom(() => {
							events.push(`${name} setup`)
							return () => events.push(`${name} cleanup`)
						}),
					)
					return () => events.push(`${name} unmount`)
				},
			})
		const first = resource('first', 1)
		const second = resource('second', 2)
		const selectFirst = primitiveAtom(true)
		const select = (read: Read) =>
			read(selectFirst) ? read(first) : read(second)
		return { events, selectFirst, select }
	}

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
			onMount: () => releaseDetail,
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
		const trigger = effectAtom(() => {
			store.peek(ephemeral, 'a')
		})
		const release = store.mountEffect(trigger)
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledOnce()
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledTimes(2)
		release()
	})

	it.each([
		[
			'effect',
			(write: () => void) => ({
				onMount: (
					_get: Read,
					_set: unknown,
					mountEffect: (effect: import('../atoms').EffectAtom) => void,
				) => mountEffect(effectAtom(write)),
			}),
		],
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
})
