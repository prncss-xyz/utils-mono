import { describe, expect, it } from 'vitest'

import { tag } from '../tags'
import { modalMachineAtom } from './modalMachineAtom'
import { createStore, primitive } from './store'

const flushMicrotask = () => Promise.resolve()

describe('modalMachineAtom', () => {
	it('transitions between modal states', async () => {
		const machine = modalMachineAtom<
			{ start: number; stop: number },
			{ running: number; stopped: number }
		>(tag('stopped', 0), {
			running: {
				stop: (event) => tag('stopped', event),
			},
			stopped: {
				start: (event) => tag('running', event),
			},
		})
		const store = createStore()

		expect(store.peek(machine)).toEqual({ payload: 0, type: 'stopped' })
		store.send(machine, { payload: 5, type: 'start' })
		await flushMicrotask()
		expect(store.peek(machine)).toEqual({ payload: 5, type: 'running' })
	})

	it('supports custom result and factory options', async () => {
		const factory = <T>(value: T) => primitive(value)
		const machine = modalMachineAtom<
			{ start: number; stop: number },
			{ running: number; stopped: number },
			string
		>(
			tag('stopped', 0),
			{
				running: {
					stop: (event) => tag('stopped', event),
				},
				stopped: {
					start: (event) => tag('running', event),
				},
			},
			{
				factory,
				result: {
					running: (value) => `Running: ${value}`,
					stopped: (value) => `Stopped: ${value}`,
				},
			},
		)
		const store = createStore()

		expect(store.peek(machine)).toBe('Stopped: 0')
		store.send(machine, { payload: 5, type: 'start' })
		await flushMicrotask()
		expect(store.peek(machine)).toBe('Running: 5')
	})
})
