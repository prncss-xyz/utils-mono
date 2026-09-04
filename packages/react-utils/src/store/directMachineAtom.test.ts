import { describe, expect, it } from 'vitest'

import { directMachineAtom } from './directMachineAtom'
import { createStore, primitive } from './store'

const flushMicrotask = () => Promise.resolve()

describe('directMachineAtom', () => {
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
	})

	it('supports custom result and factory options', async () => {
		const factory = <T>(value: T) => primitive(value)
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
