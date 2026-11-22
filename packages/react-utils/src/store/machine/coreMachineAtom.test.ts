import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { isReset, RESET } from '../../functions'
import { flushMicrotask } from '../../utils.testing'
import { createStore, primitiveAtom, type AtomSymbol } from '../store'
import { coreMachineAtom } from './coreMachineAtom'

describe('coreMachineAtom', () => {
	it('transitions from nullish states and projects them through result', async () => {
		const [machine, events] = coreMachineAtom<
			{ set: number },
			number | null | undefined,
			string
		>(undefined, (event) => (isReset(event) ? null : event.payload), {
			result: (state) => (state == null ? 'empty' : String(state)),
		})
		const store = createStore()
		expect(store.peek(machine)).toBe('empty')
		expect(store.peek(events.set.can, 2)).toBe(true)
		expect(store.peek(events.set.next, 2)).toBe('2')
		store.send(events.set, 2)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('2')
		store.send(machine, RESET)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('empty')
	})

	it('types event atoms by payload', () => {
		const [machine, events] = coreMachineAtom<
			{ set: number; clear: void },
			number,
			string
		>(0, (_event, state) => state, { result: String })
		expectTypeOf(machine).toEqualTypeOf<AtomSymbol<string, [typeof RESET]>>()
		expectTypeOf(events.set).toExtend<AtomSymbol<never, [payload: number]>>()
		expectTypeOf(events.clear).toExtend<AtomSymbol<never, []>>()
		const store = createStore()
		// @ts-expect-error void events take no payload
		store.send(events.clear, 1)
		// @ts-expect-error payload events require a payload
		store.send(events.set)
		// @ts-expect-error unknown events are rejected
		void events.unknown
	})

	it('returns the same event atom on each access', () => {
		const [, events] = coreMachineAtom<{ set: number }, number>(0, (_e, s) => s)
		expect(events.set).toBe(events.set)
	})

	it('checks state changes even when the projected result stays equal', () => {
		const [, events] = coreMachineAtom<{ set: number }, number, boolean>(
			1,
			(event, state) => (isReset(event) ? state : event.payload),
			{ result: (state) => state > 0 },
		)
		const store = createStore()
		expect(store.peek(events.set.can, 2)).toBe(true)
		expect(store.peek(events.set.next, 2)).toBe(true)
		expect(store.peek(events.set.can, 1)).toBe(false)
	})

	it('passes RESET to the transition', async () => {
		const transition = vi.fn((event: unknown, state: number) =>
			isReset(event) ? -1 : state,
		)
		const [machine] = coreMachineAtom<{}, number>(0, transition)
		const store = createStore()
		store.send(machine, RESET)
		await flushMicrotask()
		expect(transition).toHaveBeenCalledWith(
			RESET,
			0,
			expect.any(Function),
			expect.any(Function),
		)
		expect(store.peek(machine)).toBe(-1)
	})

	it('restores the initial state when the transition returns RESET', async () => {
		const [machine, events] = coreMachineAtom<
			{ set: number; reset: void },
			number
		>(0, (event, state) => {
			if (isReset(event)) return state
			return event.type === 'reset' ? RESET : event.payload
		})
		const store = createStore()
		store.send(events.set, 5)
		await flushMicrotask()
		expect(store.peek(events.reset.can)).toBe(true)
		expect(store.peek(events.reset.next)).toBe(0)
		store.send(events.reset)
		await flushMicrotask()
		expect(store.peek(machine)).toBe(0)
		expect(store.peek(events.reset.can)).toBe(false)
	})

	it.each(['can', 'next'] as const)(
		'dispatches from %s without setter arguments',
		async (family) => {
			const sideEffect = primitiveAtom(0)
			const [machine, events] = coreMachineAtom<{ SET: number }, number>(
				0,
				(event, _state, _read, write) => {
					if (isReset(event)) return 0
					write(sideEffect, event.payload)
					return event.payload
				},
			)
			const store = createStore()

			if (family === 'can') store.send(events.SET.can, 2)
			else store.send(events.SET.next, 2)
			await flushMicrotask()

			expect(store.peek(machine)).toBe(2)
			expect(store.peek(sideEffect)).toBe(2)
		},
	)

	it('transitions between states', async () => {
		type Events = { START: void; STOP: void }
		const [machine, events] = coreMachineAtom<Events, 'idle' | 'running'>(
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
		store.send(events.START)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('running')
		store.send(events.STOP)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('idle')
	})

	it('supports transition writes and effects', async () => {
		type Events = { START: void }
		const sideEffect = primitiveAtom('initial')
		const effect = vi.fn()
		let start = () => {}
		const [machine, events] = coreMachineAtom<Events, 'idle' | 'running'>(
			'idle',
			(event, state, _read, write) => {
				if (isReset(event)) return state
				write(sideEffect, 'transition')
				return 'running'
			},
			{
				effect: (next, last, _read, write) => {
					effect(next, last)
					start = () => write(events.START)
				},
			},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(machine, () => {})

		await flushMicrotask()
		expect(effect).toHaveBeenLastCalledWith('idle', undefined)

		start()
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
		const [machine, events] = coreMachineAtom<Events, number, string>(
			0,
			(event, state, _read, write) => {
				if (isReset(event)) return state
				if (event.type === 'SET') return event.payload
				write(sideEffect, true)
				return state
			},
			{ result: (state) => `Count: ${state}` },
		)
		const store = createStore()

		expect(store.peek(events.SET.next, 2)).toBe('Count: 2')
		expect(store.peek(events.SET.can, 2)).toBe(true)
		expect(store.peek(events.SIDE_EFFECT.can)).toBe(true)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('Count: 0')
		expect(store.peek(sideEffect)).toBe(false)
	})

	it('supports a custom state-symbol factory', async () => {
		type Events = { START: void }
		const factory = vi.fn((value: string) => primitiveAtom(value))
		const [machine, events] = coreMachineAtom<Events, string>(
			() => 'idle',
			() => 'running',
			{ factory },
		)
		const store = createStore()

		expect(factory).toHaveBeenCalledWith('idle')
		store.send(events.START)
		await flushMicrotask()
		expect(store.peek(machine)).toBe('running')
	})
	it('keeps projected effect values and cleanups local to each store mount', async () => {
		const log: (string | boolean | undefined)[][] = []
		const [machine, events] = coreMachineAtom<{ set: number }, number, boolean>(
			0,
			(event, state) => (isReset(event) ? state : event.payload),
			{
				result: (state) => state > 0,
				effect: (next, last) => {
					log.push(['effect', next, last])
					return () => {
						log.push(['cleanup', next])
					}
				},
			},
		)
		const first = createStore()
		const second = createStore()
		const unsubscribeFirst = first.subscribe(machine, () => {})
		const unsubscribeSecond = second.subscribe(machine, () => {})
		await flushMicrotask()
		first.send(events.set, 1)
		await flushMicrotask()
		first.send(events.set, 2)
		await flushMicrotask()
		expect(log).toEqual([
			['effect', false, undefined],
			['effect', false, undefined],
			['cleanup', false],
			['effect', true, false],
		])
		unsubscribeFirst()
		unsubscribeSecond()
		expect(log.slice(-2)).toEqual([
			['cleanup', true],
			['cleanup', false],
		])
		const unsubscribeAgain = first.subscribe(machine, () => {})
		await flushMicrotask()
		expect(log.at(-1)).toEqual(['effect', true, undefined])
		unsubscribeAgain()
	})
	it('cleans a machine effect whose first setup releases the output', async () => {
		let unsubscribe = () => {}
		const cleanup = vi.fn()
		const [machine] = coreMachineAtom<{}, number>(0, (_event, value) => value, {
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
		const [machine, events] = coreMachineAtom<{ set: number }, number>(
			0,
			(event, value) => (isReset(event) ? value : event.payload),
			{ effect },
		)
		const store = createStore()
		unsubscribe = store.subscribe(machine, () => {})
		await flushMicrotask()
		store.send(events.set, 1)
		await flushMicrotask()
		expect(cleanup).toHaveBeenCalledOnce()
		expect(effect).toHaveBeenCalledOnce()
	})
})
