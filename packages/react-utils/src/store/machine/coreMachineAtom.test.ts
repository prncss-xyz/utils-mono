import { describe, expect, it, vi } from 'vitest'

import { isReset, RESET } from '../../functions'
import { tag, type Sendable } from '../../tags'
import { flushMicrotask } from '../../utils.testing'
import { createStore, primitiveAtom } from '../store'
import { coreMachineAtom } from './coreMachineAtom'

describe('coreMachineAtom', () => {
	it('transitions from nullish states and projects them through result', async () => {
		const machine = coreMachineAtom<
			{ set: number },
			number | null | undefined,
			string
		>(undefined, (event) => (isReset(event) ? null : event.payload), {
			result: (state) => (state == null ? 'empty' : String(state)),
		})
		const store = createStore()
		expect(store.peek(machine)).toBe('empty')
		expect(store.peek(machine.can, tag('set', 2))).toBe(true)
		expect(store.peek(machine.next, tag('set', 2))).toBe('2')
		store.send(machine, tag('set', 2))
		await flushMicrotask()
		expect(store.peek(machine)).toBe('2')
		expect(store.peek(machine.next, RESET)).toBe('empty')
		store.send(machine, RESET)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('empty')
	})

	it('checks state changes even when the projected result stays equal', () => {
		const machine = coreMachineAtom<{ set: number }, number, boolean>(
			1,
			(event, state) => (isReset(event) ? state : event.payload),
			{ result: (state) => state > 0 },
		)
		const store = createStore()
		expect(store.peek(machine.can, tag('set', 2))).toBe(true)
		expect(store.peek(machine.next, tag('set', 2))).toBe(true)
		expect(store.peek(machine.can, tag('set', 1))).toBe(false)
	})

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
		store.send(machine.next, RESET)
		await flushMicrotask()
		expect(store.peek(machine)).toBe(0)
		expect(store.peek(machine.can, RESET)).toBe(false)
	})
	it.each(['can', 'next'] as const)(
		'dispatches from %s without setter arguments',
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
				store.send(machine.can, tag('SET', 2))
			} else {
				store.send(machine.next, tag('SET', 2))
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
				effect: (next, last, _read, write) => {
					effect(next, last)
					send = (event) => write(machine, event)
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
	it('keeps projected effect values and cleanups local to each store mount', async () => {
		const events: (string | boolean | undefined)[][] = []
		const machine = coreMachineAtom<{ set: number }, number, boolean>(
			0,
			(event, state) => (isReset(event) ? state : event.payload),
			{
				result: (state) => state > 0,
				effect: (next, last) => {
					events.push(['effect', next, last])
					return () => {
						events.push(['cleanup', next])
					}
				},
			},
		)
		const first = createStore()
		const second = createStore()
		const unsubscribeFirst = first.subscribe(machine, () => {})
		const unsubscribeSecond = second.subscribe(machine, () => {})
		await flushMicrotask()
		first.send(machine, tag('set', 1))
		await flushMicrotask()
		first.send(machine, tag('set', 2))
		await flushMicrotask()
		expect(events).toEqual([
			['effect', false, undefined],
			['effect', false, undefined],
			['cleanup', false],
			['effect', true, false],
		])
		unsubscribeFirst()
		unsubscribeSecond()
		expect(events.slice(-2)).toEqual([
			['cleanup', true],
			['cleanup', false],
		])
		const unsubscribeAgain = first.subscribe(machine, () => {})
		await flushMicrotask()
		expect(events.at(-1)).toEqual(['effect', true, undefined])
		unsubscribeAgain()
	})
	it('cleans a machine effect whose first setup releases the output', async () => {
		let unsubscribe = () => {}
		const cleanup = vi.fn()
		const machine = coreMachineAtom<{}, number>(0, (_event, value) => value, {
			effect: () => {
				unsubscribe()
				return cleanup
			},
		})
		const store = createStore()
		unsubscribe = store.subscribe(machine, () => {})
		await flushMicrotask()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	it('does not repeat machine cleanup when it releases the output on a transition', async () => {
		let unsubscribe = () => {}
		const cleanup = vi.fn(() => unsubscribe())
		const effect = vi.fn(() => cleanup)
		const machine = coreMachineAtom<{ set: number }, number>(
			0,
			(event, value) => (isReset(event) ? value : event.payload),
			{ effect },
		)
		const store = createStore()
		unsubscribe = store.subscribe(machine, () => {})
		await flushMicrotask()
		store.send(machine, tag('set', 1))
		await flushMicrotask()
		expect(cleanup).toHaveBeenCalledOnce()
		expect(effect).toHaveBeenCalledOnce()
	})
})
