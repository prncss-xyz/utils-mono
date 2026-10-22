import { describe, expect, it } from 'vitest'

import { RESET } from '../../functions'
import { tag } from '../../tags'
import { createStore, primitiveAtom } from '../store'
import { directMachineAtom } from './directMachineAtom'

const flushMicrotask = () => Promise.resolve()

describe('directMachineAtom', () => {
	it('supports handlers returning RESET', async () => {
		const machine = directMachineAtom(
			{ count: 0 },
			{ set: (count: number) => ({ count }), reset: (_payload: void) => RESET },
		)
		const store = createStore()
		store.send(machine, tag('set', 5))
		await flushMicrotask()
		expect(store.peek(machine.can, 'reset')).toBe(true)
		expect(store.peek(machine.next, 'reset')).toEqual({ count: 0 })
		store.send(machine, 'reset')
		await flushMicrotask()
		expect(store.peek(machine)).toEqual({ count: 0 })
	})

	it('infers event, payload, and state types', async () => {
		const machine = directMachineAtom(
			{ count: 0, status: 'idle' },
			{
				inc: (payload: number, state) => ({
					count: state.count + payload,
				}),
			},
		)
		const store = createStore()

		expect(store.peek(machine)).toEqual({ count: 0, status: 'idle' })
		store.send(machine, { payload: 5, type: 'inc' })
		await flushMicrotask()
		expect(store.peek(machine)).toEqual({ count: 5, status: 'idle' })
		expect(store.peek(machine.can, RESET)).toBe(true)
		expect(store.peek(machine.next, RESET)).toEqual({
			count: 0,
			status: 'idle',
		})
		store.send(machine, RESET)
		await flushMicrotask()
		expect(store.peek(machine)).toEqual({ count: 0, status: 'idle' })
	})

	it('supports custom result and factory options', async () => {
		const factory = <T>(value: T) => primitiveAtom(value)
		const machine = directMachineAtom(
			{ count: 0 },
			{
				inc: (payload: number, state) => ({
					count: state.count + payload,
				}),
			},
			{
				factory,
				result: (state) => `Count: ${state.count}`,
			},
		)
		const store = createStore()

		expect(store.peek(machine)).toBe('Count: 0')
		store.send(machine, { payload: 5, type: 'inc' })
		await flushMicrotask()
		expect(store.peek(machine)).toBe('Count: 5')
	})
})
