import { createStore, tag } from '@prncss-xyz/react-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
	activeAtom,
	completeTimerAtom,
	fulfilledAtom,
	timerDisplayAtom,
} from '.'
import { listAtom } from './list'
import { timeAtom } from './time'
import { runningAtom } from './timer'

beforeEach(() => {
	const values = new Map<string, string>()
	vi.stubGlobal('window', new EventTarget())
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	})
})

afterEach(() => vi.unstubAllGlobals())

test.each([
	null,
	'{',
	'null',
	'{}',
	JSON.stringify({ nextId: 1, items: [], active: '0' }),
	JSON.stringify({
		nextId: 1,
		items: [{ id: '0', duration: -1 }],
		active: '0',
	}),
	JSON.stringify({ nextId: 1, items: [{ id: '0', duration: 1 }], active: '1' }),
	JSON.stringify({ nextId: 1, items: [{ id: '1', duration: 1 }], active: '1' }),
	JSON.stringify({
		nextId: 1,
		items: [
			{ id: '0', duration: 1 },
			{ id: '0', duration: 2 },
		],
		active: '0',
	}),
])('falls back to initial timers for missing or invalid storage: %s', (raw) => {
	if (raw !== null) localStorage.setItem('timer-list', raw)
	expect(createStore().peek(listAtom)).toEqual({
		nextId: 1,
		items: [{ id: '0', duration: 1_000 }],
		active: '0',
	})
})

test('restores valid timers and persists machine updates and resets', async () => {
	const saved = {
		nextId: 3,
		items: [{ id: '2', duration: 2_500 }],
		active: '2',
	}
	localStorage.setItem('timer-list', JSON.stringify(saved))
	const store = createStore()
	expect(store.peek(listAtom)).toEqual(saved)
	store.send(listAtom, tag('create', { source: '2' }))
	await Promise.resolve()
	expect(JSON.parse(localStorage.getItem('timer-list')!)).toEqual({
		...saved,
		nextId: 4,
		items: [...saved.items, { id: '3', duration: 2_500 }],
	})
	expect(createStore().peek(listAtom)).toEqual(store.peek(listAtom))
	store.send(listAtom, tag('reset'))
	await Promise.resolve()
	expect(JSON.parse(localStorage.getItem('timer-list')!)).toEqual({
		nextId: 1,
		items: [{ id: '0', duration: 1_000 }],
		active: '0',
	})
})

test('selecting an active duration resets the running timer', async () => {
	const store = createStore()
	store.send(listAtom, tag('create', { source: '0' }))
	store.send(timeAtom, 0)
	await Promise.resolve()
	store.send(runningAtom, true)
	await Promise.resolve()
	store.send(timeAtom, 1_000)
	await Promise.resolve()
	expect(store.peek(fulfilledAtom)).toBe(true)

	store.send(activeAtom, '1')
	await Promise.resolve()
	expect(store.peek(activeAtom).id).toBe('1')
	expect(store.peek(runningAtom)).toBe(true)
	expect(store.peek(fulfilledAtom)).toBe(false)
	expect(store.peek(timerDisplayAtom)).toBe('00:00:01')
})

test('completion advances running timers and resets and stops the last timer', async () => {
	const store = createStore()
	store.send(listAtom, tag('create', { source: '0' }))
	store.send(timeAtom, 0)
	await Promise.resolve()
	store.send(runningAtom, true)
	await Promise.resolve()
	store.send(completeTimerAtom, undefined)
	await Promise.resolve()
	expect(store.peek(activeAtom).id).toBe('0')
	store.send(timeAtom, 1_000)
	await Promise.resolve()
	store.send(completeTimerAtom, undefined)
	await Promise.resolve()
	expect(store.peek(activeAtom).id).toBe('1')
	expect(store.peek(runningAtom)).toBe(true)
	expect(store.peek(fulfilledAtom)).toBe(false)
	expect(store.peek(timerDisplayAtom)).toBe('00:00:01')

	store.send(timeAtom, 2_000)
	await Promise.resolve()
	store.send(completeTimerAtom, undefined)
	await Promise.resolve()
	expect(store.peek(activeAtom).id).toBe('1')
	expect(store.peek(runningAtom)).toBe(false)
	expect(store.peek(fulfilledAtom)).toBe(false)
	expect(store.peek(timerDisplayAtom)).toBe('00:00:01')
})
