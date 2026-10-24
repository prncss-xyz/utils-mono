import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { type SetStateWithReset } from '../functions'
import { createCommands } from './commandAtoms'
import { focusAtom } from './focusAtom'
import { useAtom, useSetAtom } from './react'
import {
	atomFamily,
	createStore,
	derivedAtom,
	hydrate,
	primitiveAtom,
	type AtomSymbol,
	type Hydrate,
	type Read,
	type ResolvedAtom,
	type Write,
} from './store'

describe('setter argument tuples', () => {
	it('forwards multiple arguments through direct, resolved, and nested writes', async () => {
		const count = primitiveAtom(1)
		const update = derivedAtom(
			(read) => read(count),
			(read, write, amount: number, multiplier: number) =>
				write(count, read(count) + amount * multiplier),
		)
		const nested = derivedAtom(
			null,
			(_read, write, ...args: [number, number]) => write(update, ...args),
		)
		const store = createStore()
		const notify = vi.fn()
		store.subscribe(count, notify)
		store.send(update, 2, 3)
		store.resolve(update).send(3, 4)
		store.send(nested, 1, 5)
		expect(store.peek(count)).toBe(1)
		await Promise.resolve()
		expect(store.peek(count)).toBe(24)
		expect(notify).toHaveBeenCalledOnce()
	})

	it('keeps family keys separate, including undefined keys', async () => {
		const members = atomFamily((key: string | undefined) => {
			const value = primitiveAtom(key?.length ?? 0)
			return derivedAtom(
				(read) => read(value),
				(read, write, amount: number, multiplier: number) =>
					write(value, read(value) + amount * multiplier),
			)
		})
		const nested = derivedAtom(null, (_read, write) =>
			write(members, undefined, 1, 2),
		)
		const store = createStore()
		store.send(members, undefined, 2, 3)
		store.resolve(members, undefined).send(3, 4)
		store.send(nested)
		store.send(members, 'other', 4, 5)
		await Promise.resolve()
		expect(store.peek(members, undefined)).toBe(20)
		expect(store.peek(members, 'other')).toBe(25)
	})

	it('preserves omitted optional arguments, explicit undefined, and rest arguments', () => {
		const calls: unknown[][] = []
		const optional = derivedAtom(
			null,
			(_read, _write, ...args: [value?: number]) => {
				calls.push(args)
			},
		)
		const zero = derivedAtom(null, (_read, _write, ...args: []) => {
			calls.push(args)
		})
		const rest = derivedAtom(
			null,
			(_read, _write, label: string, ...values: number[]) => {
				calls.push([label, ...values])
			},
		)
		const family = atomFamily((_key: undefined) => optional)
		const store = createStore()
		store.send(zero)
		store.resolve(zero).send()
		store.send(optional)
		store.send(optional, undefined)
		store.resolve(optional).send()
		store.resolve(optional).send(undefined)
		store.send(family, undefined)
		store.send(family, undefined, undefined)
		store.send(optional, 3)
		store.send(rest, 'empty')
		store.resolve(rest).send('many', 1, 2, 3)
		expect(calls).toEqual([
			[],
			[],
			[],
			[undefined],
			[],
			[undefined],
			[],
			[undefined],
			[3],
			['empty'],
			['many', 1, 2, 3],
		])
	})

	it('hydrates raw and helper entries with zero, multiple, and optional arguments', () => {
		const calls: unknown[][] = []
		const zero = derivedAtom(null, (_read, _write, ...args: []) => {
			calls.push(args)
		})
		const optional = derivedAtom(null, (_read, _write, ...args: [number?]) => {
			calls.push(args)
		})
		const zeroFamily = atomFamily((_key: undefined) => zero)
		const count = primitiveAtom(0)
		const update = derivedAtom(
			null,
			(read, write, amount: number, multiplier: number) =>
				write(count, read(count) + amount * multiplier),
		)
		const family = atomFamily((_key: string) => update)
		const entries = [
			hydrate(zero),
			hydrate(zeroFamily, undefined),
			hydrate(update, 2, 3),
			hydrate(family, 'a', 3, 4),
		] as const
		const store = createStore([
			...entries,
			[zero],
			[zeroFamily, undefined],
			[update, 1, 5],
			[family, 'b', 2, 2],
			[optional],
			[optional, undefined],
			hydrate(optional),
			hydrate(optional, undefined),
		])
		expect(store.peek(count)).toBe(27)
		expect(calls).toEqual([[], [], [], [], [], [undefined], [], [undefined]])
	})

	it('forwards argument tuples from mount and effect writes', async () => {
		const calls: unknown[][] = []
		const command = derivedAtom(
			null,
			(_read, _write, ...args: [string, number]) => {
				calls.push(args)
			},
		)
		const source = primitiveAtom(0, {
			onMount: (_read, write) => write(command, 'mount', 1),
			effect: (_next, _last, _read, write) => write(command, 'effect', 2),
		})
		const store = createStore()
		const release = store.subscribe(source, () => {})
		await Promise.resolve()
		expect(calls).toEqual([
			['mount', 1],
			['effect', 2],
		])
		release()
	})

	it('forwards command arguments without changing their length', () => {
		const dependencies = {
			zero: vi.fn<() => void>(),
			update: vi.fn<(n: number, label: string, enabled?: boolean) => void>(),
			rest: vi.fn<(...args: number[]) => void>(),
		}
		const { dependencyAtom, cmd } = createCommands<typeof dependencies>()
		const store = createStore([hydrate(dependencyAtom, dependencies)])
		store.send(cmd.zero)
		store.send(cmd.update, 2, 'hello')
		store.resolve(cmd.update).send(3, 'world', undefined)
		store.send(cmd.rest, 1, 2, 3)
		expect(dependencies.zero.mock.calls).toEqual([[]])
		expect(dependencies.update.mock.calls).toEqual([
			[2, 'hello'],
			[3, 'world', undefined],
		])
		expect(dependencies.rest.mock.calls).toEqual([[1, 2, 3]])
		expectTypeOf(cmd.update).toEqualTypeOf<
			AtomSymbol<never, Parameters<typeof dependencies.update>>
		>()
	})

	it('infers tuple types and rejects invalid calls across the public API', () => {
		const count = primitiveAtom(0)
		const update = derivedAtom(
			(read) => read(count),
			(_read, _write, _n: number, _label: string) => {},
		)
		const explicit = derivedAtom<number, [n: number]>(
			() => 0,
			(_read, _write, _n) => {},
		)
		const optional = derivedAtom(null, (_read, _write, _n?: number) => {})
		const rest = derivedAtom(null, (_read, _write, ..._values: number[]) => {})
		const writeOnly = derivedAtom(null, (_read, _write, _n: number) => {})
		const readOnly = derivedAtom(() => 0)
		const focused = focusAtom(readOnly, { getter: (n) => String(n) })
		const zero = derivedAtom(null, () => {})
		const family = atomFamily((_key: string) => update)
		const zeroFamily = atomFamily((_key: undefined) => zero)
		const readOnlyFamily = atomFamily((_key: string) => readOnly)
		const store = createStore()
		expectTypeOf(update).toEqualTypeOf<AtomSymbol<number, [number, string]>>()
		expectTypeOf(explicit).toEqualTypeOf<AtomSymbol<number, [number]>>()
		expectTypeOf(optional).toEqualTypeOf<AtomSymbol<never, [number?]>>()
		expectTypeOf(rest).toEqualTypeOf<AtomSymbol<never, number[]>>()
		expectTypeOf(writeOnly).toEqualTypeOf<AtomSymbol<never, [number]>>()
		expectTypeOf(readOnly).toEqualTypeOf<AtomSymbol<number, never>>()
		expectTypeOf(focused).toEqualTypeOf<AtomSymbol<string, never>>()
		expectTypeOf(count).toEqualTypeOf<
			AtomSymbol<number, [SetStateWithReset<number>]>
		>()
		expectTypeOf(update).toExtend<AtomSymbol<any, any>>()
		expectTypeOf(store.resolve(update)).toEqualTypeOf<
			ResolvedAtom<number, [number, string]>
		>()
		expectTypeOf([hydrate(update, 1, 'a'), hydrate(zero)]).toExtend<Hydrate>()

		// These calls are checked by tsc, never executed.
		const checkTypes = (write: Write, read: Read) => {
			write(update, 1, 'ok')
			write(family, 'key', 1, 'ok')
			write(zero)
			write(zeroFamily, undefined)
			read(readOnly)
			store.send(writeOnly, 1)
			// @ts-expect-error missing argument
			store.send(update, 1)
			// @ts-expect-error excess argument
			store.send(update, 1, 'a', false)
			// @ts-expect-error wrong argument type
			store.send(update, 'a', 'b')
			// @ts-expect-error primitives require one argument
			store.send(count)
			// @ts-expect-error primitives reject extra arguments
			store.send(count, 1, 2)
			// @ts-expect-error no-argument setters reject explicit undefined
			store.send(zero, undefined)
			// @ts-expect-error the family key cannot be omitted
			store.send(zeroFamily)
			// @ts-expect-error wrong family key type
			store.send(family, 123, 1, 'a')
			// @ts-expect-error family setter arguments are required after the key
			write(family, 'key', 1)
			// @ts-expect-error read-only atoms reject no-argument sends
			store.send(readOnly)
			// @ts-expect-error read-only atoms reject sends with arguments
			store.send(readOnly, 1)
			// @ts-expect-error read-only atoms reject Write
			write(readOnly)
			// @ts-expect-error read-only atoms reject Write with arguments
			write(readOnly, 1)
			// @ts-expect-error resolved read-only atoms cannot be written
			store.resolve(readOnly).send()
			// @ts-expect-error resolved read-only atoms reject arguments too
			store.resolve(readOnly).send(1)
			// @ts-expect-error read-only families cannot be written
			store.send(readOnlyFamily, 'key')
			// @ts-expect-error Write cannot dispatch read-only family members
			write(readOnlyFamily, 'key')
			// @ts-expect-error focused read-only atoms cannot be written
			store.send(focused, 'a')
			// @ts-expect-error resolved setters validate argument types
			store.resolve(update).send('a', 'b')
			// @ts-expect-error hydration requires every argument
			hydrate(update, 1)
			// @ts-expect-error hydration rejects excess arguments
			hydrate(update, 1, 'a', false)
			// @ts-expect-error family hydration requires every setter argument
			hydrate(family, 'key', 1)
			// @ts-expect-error family hydration rejects excess setter arguments
			hydrate(family, 'key', 1, 'a', false)
			hydrate(
				update,
				// @ts-expect-error NoInfer pins the tuple; the error is on this argument
				'bad',
				'a',
			)
			// @ts-expect-error a family still requires a key for zero arguments
			hydrate(zeroFamily)
			// @ts-expect-error read-only hydration is forbidden
			hydrate(readOnly)
			// @ts-expect-error read-only hydration with arguments is forbidden
			hydrate(readOnly, 1)
			// @ts-expect-error read-only family hydration is forbidden
			hydrate(readOnlyFamily, 'key')
			// @ts-expect-error raw hydration rejects missing arguments
			createStore([[update, 1]])
			// @ts-expect-error raw hydration rejects excess arguments
			createStore([[update, 1, 'a', false]])
			// @ts-expect-error raw hydration rejects wrong arguments
			createStore([[update, 'bad', 'a']])
			// @ts-expect-error raw hydration validates the family key
			createStore([[family, 1, 1, 'a']])
			// @ts-expect-error raw family hydration requires every setter argument
			createStore([[family, 'key', 1]])
			// @ts-expect-error raw family hydration rejects excess setter arguments
			createStore([[family, 'key', 1, 'a', false]])
			// @ts-expect-error raw hydration requires a family key
			createStore([[zeroFamily]])
			// @ts-expect-error raw hydration rejects read-only atoms
			createStore([[readOnly]])
			// @ts-expect-error raw hydration rejects read-only atoms with arguments
			createStore([[readOnly, 1]])
			// @ts-expect-error raw hydration rejects read-only families
			createStore([[readOnlyFamily, 'key']])
			derivedAtom<number>(
				() => 0,
				// @ts-expect-error explicit value generics also need an explicit argument tuple
				(_read: Read, _write: Write, _n: number) => {},
			)
		}
		expect(checkTypes).toBeTypeOf('function')

		function useCheckSetterTypes() {
			expectTypeOf(useSetAtom(update)).toEqualTypeOf<
				(n: number, label: string) => void
			>()
			expectTypeOf(useAtom(update)[1]).toEqualTypeOf<
				(n: number, label: string) => void
			>()
			expectTypeOf(useSetAtom(family, 'key')).toEqualTypeOf<
				(n: number, label: string) => void
			>()
			expectTypeOf(useAtom(family, 'key')[1]).toEqualTypeOf<
				(n: number, label: string) => void
			>()
			// @ts-expect-error read-only hook setters cannot be called
			useSetAtom(readOnly)()
			// @ts-expect-error read-only hook setters reject arguments
			useSetAtom(readOnly)(1)
			// @ts-expect-error useAtom cannot write a read-only atom
			useAtom(readOnly)[1]()
			// @ts-expect-error useAtom cannot write a read-only atom with arguments
			useAtom(readOnly)[1](1)
			// @ts-expect-error hook families require a key
			useSetAtom(zeroFamily)
			// @ts-expect-error hook families require a key
			useAtom(zeroFamily)
			// @ts-expect-error read-only family hook setters cannot be called
			useSetAtom(readOnlyFamily, 'key')()
			// @ts-expect-error read-only family useAtom setters cannot be called
			useAtom(readOnlyFamily, 'key')[1]()
		}
		expect(useCheckSetterTypes).toBeTypeOf('function')
	})
})
