import { describe, expect, expectTypeOf, it } from 'vitest'

import { isReset } from '../functions'
import { tag } from '../tags'
import { coreMachineAtom } from './coreMachineAtom'
import { focusAtom } from './focusAtom'
import { createStore, primitiveAtom } from './store'

function setup() {
	const sideEffect = primitiveAtom(0)
	const machine = coreMachineAtom<
		{ set: number; remove: void },
		{ count: number } | null
	>({ count: 1 }, (event, state, _read, write) => {
		if (isReset(event)) return state
		if (event.type === 'remove') return null
		if (event.payload < 0 || state == null) return state
		write(sideEffect, event.payload)
		return { count: event.payload }
	})
	const focused = focusAtom(machine, {
		getter: (state) => state.count,
		setter: (count) => tag('set', count),
		remover: () => tag('remove'),
	})
	return { store: createStore(), machine, focused, sideEffect }
}

describe('focusAtom previews', () => {
	it('maps values and updater functions through machine guards without writing', () => {
		const { store, focused, machine, sideEffect } = setup()
		expectTypeOf(store.peek(focused.next, 2)).toEqualTypeOf<number | null>()
		expect(store.peek(focused.can, 2)).toBe(true)
		expect(store.peek(focused.next, 2)).toBe(2)
		expect(store.peek(focused.can, -1)).toBe(false)
		expect(store.peek(focused.next, -1)).toBe(1)
		expect(store.peek(focused.next, (count) => count + 3)).toBe(4)
		expect(store.peek(machine)).toEqual({ count: 1 })
		expect(store.peek(sideEffect)).toBe(0)
	})

	it.each(['can', 'next'] as const)(
		'dispatches updates through %s and tracks changes',
		async (family) => {
			const { store, focused, sideEffect } = setup()
			const preview = store.resolve(focused.next, (count) => count + 1)
			expect(preview.peek()).toBe(2)
			if (family === 'can') store.send(focused.can, 4, undefined)
			else store.send(focused.next, 4, undefined)
			await Promise.resolve()
			expect(store.peek(focused)).toBe(4)
			expect(store.peek(sideEffect)).toBe(4)
			expect(preview.peek()).toBe(5)
		},
	)

	it('previews removal and treats nullish sources as no-ops', async () => {
		const { store, focused } = setup()
		expect(store.peek(focused.can, null)).toBe(true)
		expect(store.peek(focused.next, undefined)).toBeNull()
		store.send(focused.next, null, undefined)
		await Promise.resolve()
		expect(store.peek(focused.can, 2)).toBe(false)
		expect(store.peek(focused.next, 2)).toBeNull()
		store.send(focused.can, 2, undefined)
		await Promise.resolve()
		expect(store.peek(focused)).toBeNull()
	})

	it('supports modifier-only focuses and nested focuses', () => {
		const { store, machine } = setup()
		const focused = focusAtom(machine, {
			getter: (state) => state.count,
			modifier: (modify, state) => tag('set', modify(state.count)),
		})
		expect(store.peek(focused.next, (count) => count + 2)).toBe(3)
		const nested = focusAtom(focused, {
			getter: (count) => String(count),
			setter: (value) => () => Number(value),
		})
		expect(store.peek(nested.next, '5')).toBe('5')
		expect(store.peek(nested.can, '-1')).toBe(false)
	})

	it('keeps ordinary source atoms supported', async () => {
		const focused = focusAtom(primitiveAtom({ count: 1 }), {
			getter: (state) => state.count,
			setter: (count) => ({ count }),
		})
		const store = createStore()
		store.send(focused, (count) => count + 1)
		await Promise.resolve()
		expect(store.peek(focused)).toBe(2)
	})
})
