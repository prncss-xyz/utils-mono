import { assert, describe, expect, it, vi } from 'vitest'

import {
	derivedAtom,
	effectAtom,
	atomFamily,
	primitiveAtom,
	TRANSIENT,
	type AtomSymbol,
	type Read,
	type Store,
} from '.'
import { type SetStateWithReset } from '../../functions'
import { createCommands } from '../commandAtoms'
import {
	createStore,
	flushMicrotask,
	internalInstance,
	mountedSubCount,
} from './utils.testing'

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

describe('family eviction', () => {
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
		const unmount = store.mountEffect(trigger)
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledOnce()
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledTimes(2)
		unmount()
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
			const unsubscribe = store.subscribe(names, 'first', () => {})
			await flushMicrotask()
			unsubscribe()
			const trigger = primitiveAtom(
				0,
				options(() => store.send(names, 'first', 'saved')),
			)
			const unsubscribeTrigger = store.subscribe(trigger, () => {})
			await flushMicrotask()
			await flushMicrotask()
			expect(store.peek(names, 'first')).toBe('saved')
			expect(create).toHaveBeenCalledOnce()
			unsubscribeTrigger()
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

	it('retains a written never-mounted primitive member across later flushes', async () => {
		const create = vi.fn((_key: string) => primitiveAtom(0))
		const values = atomFamily(create)
		const store = createStore()
		store.send(values, 'a', 3)
		await flushMicrotask()
		await flushMicrotask()
		expect(store.peek(values, 'a')).toBe(3)
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
})
