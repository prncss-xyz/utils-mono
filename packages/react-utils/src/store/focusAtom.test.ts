import { describe, expect, expectTypeOf, it } from 'vitest'

import { focusAtom } from './focusAtom'
import { createStore, primitiveAtom } from './store'
import { flushMicrotask } from './store/utils.testing'

function setup() {
	const source = primitiveAtom<{ count: number } | null>({ count: 1 })
	const focused = focusAtom(source, {
		getter: (state) => state.count,
		setter: (count) => ({ count }),
		remover: () => null,
	})
	return { store: createStore(), source, focused }
}

describe('focusAtom', () => {
	it('projects values and dispatches focused updates', async () => {
		const { store, focused, source } = setup()
		expectTypeOf(store.peek(focused)).toEqualTypeOf<number | null>()
		expect(store.peek(focused)).toBe(1)
		store.send(focused, 4)
		await flushMicrotask()
		expect(store.peek(focused)).toBe(4)
		expect(store.peek(source)).toEqual({ count: 4 })
	})

	it('supports removal and ignores updates to nullish sources', async () => {
		const { store, focused } = setup()
		store.send(focused, null)
		await flushMicrotask()
		expect(store.peek(focused)).toBeNull()
		store.send(focused, 2)
		await flushMicrotask()
		expect(store.peek(focused)).toBeNull()
	})

	it('supports modifier-only and nested focuses', async () => {
		const { store, source } = setup()
		const focused = focusAtom(source, {
			getter: (state) => state.count,
			modifier: (modify, state) => ({ count: modify(state.count) }),
		})
		const nested = focusAtom(focused, {
			getter: (count) => String(count),
			setter: (value) => () => Number(value),
		})
		store.send(nested, '5')
		await flushMicrotask()
		expect(store.peek(nested)).toBe('5')
	})

	it('applies functional updates through the getter and setter', async () => {
		const focused = focusAtom(primitiveAtom({ count: 1 }), {
			getter: (state) => state.count,
			setter: (count) => ({ count }),
		})
		const store = createStore()
		store.send(focused, (count) => count + 1)
		await flushMicrotask()
		expect(store.peek(focused)).toBe(2)
	})
})
