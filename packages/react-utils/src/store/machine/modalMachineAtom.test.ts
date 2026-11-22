import { describe, expect, it } from 'vitest'

import { RESET } from '../../functions'
import { tag } from '../../tags'
import { flushMicrotask } from '../../utils.testing'
import { createStore, primitiveAtom } from '../store'
import { modalMachineAtom } from './modalMachineAtom'

describe('modalMachineAtom', () => {
	it('supports handlers returning RESET', async () => {
		const [machine, events] = modalMachineAtom<
			{ set: number; reset: void },
			{ idle: number }
		>(tag('idle', 0), {
			idle: { set: (value) => tag('idle', value), reset: () => RESET },
		})
		const store = createStore()
		store.send(events.set, 5)
		await flushMicrotask()
		expect(store.peek(events.reset.can)).toBe(true)
		expect(store.peek(events.reset.next)).toEqual(tag('idle', 0))
		store.send(events.reset)
		await flushMicrotask()
		expect(store.peek(machine)).toEqual(tag('idle', 0))
	})

	it('shallow merges payloads within a mode and preserves unchanged state', async () => {
		const [machine, events] = modalMachineAtom<
			{ reset: void; set: number; start: void },
			{ idle: { elapsed: number }; running: { since: number } }
		>(tag('idle', { elapsed: 0 }), {
			idle: {
				reset: () => tag('idle', { elapsed: 0 }),
				set: (elapsed) => tag('idle', { elapsed }),
				start: () => tag('running', { since: 0 }),
			},
			running: {},
		})
		const store = createStore()
		const initial = store.peek(machine)

		expect(store.peek(events.reset.can)).toBe(false)
		store.send(events.reset)
		await flushMicrotask()
		expect(store.peek(machine)).toBe(initial)

		store.send(events.set, 5)
		await flushMicrotask()
		expect(store.peek(machine)).toEqual(tag('idle', { elapsed: 5 }))
		expect(store.peek(events.reset.can)).toBe(true)

		store.send(events.start)
		await flushMicrotask()
		expect(store.peek(machine)).toEqual(tag('running', { since: 0 }))
	})

	it('transitions between modal states', async () => {
		const [machine, events] = modalMachineAtom<
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
		store.send(events.start, 5)
		await flushMicrotask()
		expect(store.peek(machine)).toEqual({ payload: 5, type: 'running' })
		store.send(machine, RESET)
		await flushMicrotask()
		expect(store.peek(machine)).toEqual(tag('stopped', 0))
	})

	it('supports custom result and factory options', async () => {
		const factory = <T>(value: T) => primitiveAtom(value)
		const [machine, events] = modalMachineAtom<
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
		store.send(events.start, 5)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('Running: 5')
	})
})
