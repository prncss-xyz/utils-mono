import { describe, expect, it, vi } from 'vitest'

import { tag, type Sendable } from '../tags'
import { coreMachineAtom } from './coreMachineAtom'
import { createStore, primitive } from './store'

const flushMicrotask = () => Promise.resolve()

describe('coreMachineAtom', () => {
	it('transitions between states', async () => {
		type Events = { START: void; STOP: void }
		const machine = coreMachineAtom<Events, 'idle' | 'running'>(
			'idle',
			(event, state) => {
				if (event.type === 'START') return 'running'
				if (event.type === 'STOP') return 'idle'
				return state
			},
		)
		const store = createStore()

		expect(store.peek(machine)).toBe('idle')
		store.send(machine, 'START')
		await flushMicrotask()
		expect(store.peek(machine)).toBe('running')
		store.send(machine, 'STOP')
		await flushMicrotask()
		expect(store.peek(machine)).toBe('idle')
	})

	it('supports transition writes and effects', async () => {
		type Events = { START: void }
		const sideEffect = primitive('initial')
		const effect = vi.fn()
		let send: (event: Sendable<Events>) => void = () => {}
		const machine = coreMachineAtom<Events, 'idle' | 'running'>(
			'idle',
			(event, state, _read, write) => {
				if (event.type !== 'START') return state
				write(sideEffect, 'transition')
				return 'running'
			},
			{
				effect: (next, last, sendEvent) => {
					effect(next, last)
					send = sendEvent
				},
			},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(machine, () => {})

		await flushMicrotask()
		expect(effect).toHaveBeenLastCalledWith('idle', undefined)

		send('START')
		await flushMicrotask()
		expect(effect).toHaveBeenLastCalledWith('running', 'idle')
		expect(store.peek(sideEffect)).toBe('transition')

		unsubscribe()
		expect(effect).toHaveBeenLastCalledWith(undefined, 'running')
	})

	it('predicts results without applying transition writes', async () => {
		type Events = { SET: number; SIDE_EFFECT: void }
		const sideEffect = primitive(false)
		const machine = coreMachineAtom<Events, number, string>(
			0,
			(event, state, _read, write) => {
				if (event.type === 'SET') return event.payload
				if (event.type === 'SIDE_EFFECT') write(sideEffect, true)
				return state
			},
			{ result: (state) => `Count: ${state}` },
		)
		const store = createStore()

		expect(store.peek(machine.next, tag('SET', 2))).toBe('Count: 2')
		expect(store.peek(machine.can, tag('SET', 2))).toBe(true)
		expect(store.peek(machine.can, 'SIDE_EFFECT')).toBe(true)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('Count: 0')
		expect(store.peek(sideEffect)).toBe(false)
	})

	it('supports a custom state-symbol factory', async () => {
		type Events = { START: void }
		const factory = vi.fn((value: string) => primitive(value))
		const machine = coreMachineAtom<Events, string>(
			() => 'idle',
			() => 'running',
			{ factory },
		)
		const store = createStore()

		expect(factory).toHaveBeenCalledWith('idle')
		store.send(machine, 'START')
		await flushMicrotask()
		expect(store.peek(machine)).toBe('running')
	})
})
