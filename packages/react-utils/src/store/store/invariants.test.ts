import { describe, expect, it } from 'vitest'

import {
	atomFamily,
	createStore,
	type AtomFamilyOptions,
	derivedAtom,
	primitiveAtom,
	TRANSIENT,
} from '.'

describe('store graph invariants', () => {
	it('rejects a getter that reads itself', () => {
		const atom = derivedAtom<number>((read): number => read(atom))
		const store = createStore()

		expect(() => store.peek(atom)).toThrow('cyclic atom dependency')
	})

	it('rejects a cycle through multiple getters', () => {
		const first = derivedAtom<number>((read): number => read(second))
		const second = derivedAtom<number>((read): number => read(first))
		const store = createStore()

		expect(() => store.peek(first)).toThrow('cyclic atom dependency')
	})

	it('rejects a cycle introduced after an unmounted cache was populated', async () => {
		const flag = primitiveAtom(false)
		const first = derivedAtom<number>((read): number => read(second))
		const second = derivedAtom<number>((read): number =>
			read(flag) ? read(first) : 1,
		)
		const store = createStore()

		expect(store.peek(first)).toBe(1)
		store.send(flag, true)
		await Promise.resolve()

		expect(() => store.peek(first)).toThrow('cyclic atom dependency')
	})

	it.each([false, true])(
		'rejects pending getter cycles (indirect: %s)',
		async (indirect) => {
			const count = primitiveAtom(0)
			const first = derivedAtom<number>((read): number =>
				read(indirect ? second : first),
			)
			const second = derivedAtom<number>((read): number => read(first))
			const command = derivedAtom(null, (read) => {
				read(first)
			})
			const store = createStore()
			store.send(count, 1)

			expect(() => store.send(command)).toThrow('cyclic atom dependency')
			await Promise.resolve()
			expect(store.peek(count)).toBe(1)
		},
	)

	it('allows repeated reads of a shared dependency', async () => {
		const source = primitiveAtom(1)
		const left = derivedAtom((read) => read(source) + 1)
		const right = derivedAtom((read) => read(source) + read(source))
		const leaf = derivedAtom((read) => read(left) + read(right))
		const command = derivedAtom(null, (read, write) =>
			write(source, read(leaf)),
		)
		const store = createStore()

		expect(store.peek(leaf)).toBe(4)
		store.send(source, 2)
		store.send(command)
		await Promise.resolve()
		expect(store.peek(source)).toBe(7)
		expect(store.peek(leaf)).toBe(22)
	})
})

describe('atom family options', () => {
	it.each([-Infinity, -2, -0.5, TRANSIENT])('keeps TTL %s transient', (TTL) => {
		const family = atomFamily(() => primitiveAtom({}), { TTL })
		const store = createStore()

		expect(store.peek(family, 'key')).not.toBe(store.peek(family, 'key'))
	})

	it.each<[string, AtomFamilyOptions<string[]>, string]>([
		['a NaN TTL', { TTL: NaN }, 'atomFamily TTL must not be NaN'],
		[
			'both hash and eq',
			{
				hash: (key: string[]) => key.join(),
				eq: (a: string[], b: string[]) => a.length === b.length,
			} as never,
			'atomFamily accepts either hash or eq, not both',
		],
	])('rejects %s', (_label, options, message) => {
		expect(() =>
			atomFamily((key: string[]) => primitiveAtom(key.length), options),
		).toThrow(message)
	})
})
