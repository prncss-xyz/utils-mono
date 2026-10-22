import { describe, expect, expectTypeOf, it } from 'vitest'

import { isReset } from '../functions'
import { tag } from '../tags'
import { focusAtom } from './focusAtom'
import { coreMachineAtom } from './machine/coreMachineAtom'
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

describe('focusAtom', () => {
	it('projects values and dispatches focused updates', async () => {
		const { store, focused, machine, sideEffect } = setup()
		expectTypeOf(store.peek(focused)).toEqualTypeOf<number | null>()
		expect(store.peek(focused)).toBe(1)
		expectTypeOf(store.peek(focused.can, 4)).toEqualTypeOf<boolean>()
		expect(store.peek(focused.can, 4)).toBe(true)
		expect(store.peek(focused.can, -1)).toBe(false)
		store.send(focused, 4)
		await Promise.resolve()
		expect(store.peek(focused)).toBe(4)
		expect(store.peek(machine)).toEqual({ count: 4 })
		expect(store.peek(sideEffect)).toBe(4)
	})

	it('supports removal and ignores updates to nullish sources', async () => {
		const { store, focused } = setup()
		store.send(focused, null)
		await Promise.resolve()
		expect(store.peek(focused)).toBeNull()
		expect(store.peek(focused.can, 2)).toBe(false)
		store.send(focused, 2)
		await Promise.resolve()
		expect(store.peek(focused)).toBeNull()
	})

	it('supports modifier-only and nested focuses', async () => {
		const { store, machine } = setup()
		const focused = focusAtom(machine, {
			getter: (state) => state.count,
			modifier: (modify, state) => tag('set', modify(state.count)),
		})
		const nested = focusAtom(focused, {
			getter: (count) => String(count),
			setter: (value) => () => Number(value),
		})
		expect(store.peek(nested.can, '5')).toBe(true)
		store.send(nested, '5')
		await Promise.resolve()
		expect(store.peek(nested)).toBe('5')
	})

	it('supports ordinary source atoms', async () => {
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
