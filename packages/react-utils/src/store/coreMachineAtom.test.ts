import { describe, expect, it, vi } from 'vitest'

import { isReset, RESET } from '../functions'
import { tag, type Sendable } from '../tags'
import { coreMachineAtom } from './coreMachineAtom'
import { createStore, primitiveAtom } from './store'

const flushMicrotask = () => Promise.resolve()

describe('coreMachineAtom', () => {
	it('passes RESET through previews and sends', async () => {
		const machine = coreMachineAtom<{ set: number }, number>(0, (event) =>
			isReset(event) ? 0 : event.payload,
		)
		const store = createStore()
		store.send(machine, tag('set', 5))
		await flushMicrotask()
		expect(store.peek(machine.can, RESET)).toBe(true)
		expect(store.peek(machine.next, RESET)).toBe(0)
		expect(store.peek(machine)).toBe(5)
		store.send(machine.next, RESET, undefined)
		await flushMicrotask()
		expect(store.peek(machine)).toBe(0)
		expect(store.peek(machine.can, RESET)).toBe(false)
	})
	it.each(['can', 'next'] as const)(
		'forwards void events from %s to the machine',
		async (family) => {
			const sideEffect = primitiveAtom(0)
			const machine = coreMachineAtom<{ SET: number }, number>(
				0,
				(event, _state, _read, write) => {
					if (isReset(event)) return 0
					write(sideEffect, event.payload)
					return event.payload
				},
			)
			const store = createStore()

			if (family === 'can') {
				store.send(machine.can, tag('SET', 2), undefined)
			} else {
				store.send(machine.next, tag('SET', 2), undefined)
			}
			await flushMicrotask()

			expect(store.peek(machine)).toBe(2)
			expect(store.peek(sideEffect)).toBe(2)
		},
	)

	it('transitions between states', async () => {
		type Events = { START: void; STOP: void }
		const machine = coreMachineAtom<Events, 'idle' | 'running'>(
			'idle',
			(event, state) => {
				if (isReset(event)) return state
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
		const sideEffect = primitiveAtom('initial')
		const effect = vi.fn()
		let send: (event: Sendable<Events>) => void = () => {}
		const machine = coreMachineAtom<Events, 'idle' | 'running'>(
			'idle',
			(event, state, _read, write) => {
				if (isReset(event)) return state
				if (event.type !== 'START') return state
				write(sideEffect, 'transition')
				return 'running'
			},
			{
				effect: (next, last, _get, set) => {
					effect(next, last)
					send = (event) => set(machine, event)
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
		expect(effect).toHaveBeenCalledTimes(2)
		expect(effect).toHaveBeenLastCalledWith('running', 'idle')
	})

	it('predicts results without applying transition writes', async () => {
		type Events = { SET: number; SIDE_EFFECT: void }
		const sideEffect = primitiveAtom(false)
		const machine = coreMachineAtom<Events, number, string>(
			0,
			(event, state, _read, write) => {
				if (isReset(event)) return state
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
		const factory = vi.fn((value: string) => primitiveAtom(value))
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
