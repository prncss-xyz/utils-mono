import { createStore, tag } from '@prncss-xyz/react-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
	activeAtom,
	activateListAtom,
	clearListAtom,
	removeListAtom,
	completeTimerAtom,
	fulfilledAtom,
	timerDisplayAtom,
} from '.'
import { activeListAtom, allListAtom } from './list'
import { timeAtom } from './time'
import { runningAtom, timerAtom } from './timer'

beforeEach(() => {
	const values = new Map<string, string>()
	if (typeof window === 'undefined') vi.stubGlobal('window', new EventTarget())
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
	JSON.stringify({ nextItemId: 1, items: [], active: '0' }),
	JSON.stringify({
		nextItemId: 1,
		items: [{ id: '0', duration: -1 }],
		active: '0',
	}),
	JSON.stringify({
		nextItemId: 1,
		items: [{ id: '0', duration: 1 }],
		active: '1',
	}),
	JSON.stringify({
		nextItemId: 1,
		items: [{ id: '1', duration: 1 }],
		active: '1',
	}),
	JSON.stringify({
		nextItemId: 1,
		items: [
			{ id: '0', duration: 1 },
			{ id: '0', duration: 2 },
		],
		active: '0',
	}),
])('falls back to initial timers for missing or invalid storage: %s', (raw) => {
	if (raw !== null) localStorage.setItem('timer-list', raw)
	expect(createStore().peek(allListAtom)).toEqual({
		nextItemId: 1,
		nextListId: 1,
		active: '0',
		lists: {
			'0': { name: '', items: [{ id: '0', duration: 0 }], active: '0' },
		},
	})
})

test('restores valid timers and persists machine updates and clears', async () => {
	const saved = {
		nextItemId: 3,
		nextListId: 1,
		active: '0',
		lists: {
			'0': { name: '', items: [{ id: '2', duration: 2_500 }], active: '2' },
		},
	}
	localStorage.setItem('timer-list', JSON.stringify(saved))
	const store = createStore()
	expect(store.peek(allListAtom)).toEqual(saved)
	store.send(allListAtom, tag('clone', { source: '2' }))
	await Promise.resolve()
	expect(JSON.parse(localStorage.getItem('timer-list')!)).toEqual({
		...saved,
		nextItemId: 4,
		lists: {
			'0': {
				name: '',
				active: '2',
				items: [...saved.lists['0'].items, { id: '3', duration: 2_500 }],
			},
		},
	})
	expect(createStore().peek(allListAtom)).toEqual(store.peek(allListAtom))
	store.send(allListAtom, tag('clearList', { list: '0' }))
	await Promise.resolve()
	expect(JSON.parse(localStorage.getItem('timer-list')!)).toEqual({
		nextItemId: 5,
		nextListId: 1,
		active: '0',
		lists: {
			'0': { name: '', items: [{ id: '4', duration: 0 }], active: '4' },
		},
	})
})

test('selecting an active duration resets the running timer', async () => {
	const store = createStore()
	store.send(allListAtom, tag('update', { target: '0', duration: 1_000 }))
	await Promise.resolve()
	store.send(allListAtom, tag('clone', { source: '0' }))
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
	store.send(allListAtom, tag('update', { target: '0', duration: 1_000 }))
	await Promise.resolve()
	store.send(allListAtom, tag('clone', { source: '0' }))
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

test('activeListAtom projects the selected list', () => {
	const saved = {
		nextItemId: 2,
		nextListId: 2,
		active: 'second',
		lists: {
			first: { name: '', items: [{ id: '0', duration: 1_000 }], active: '0' },
			second: { name: '', items: [{ id: '1', duration: 2_000 }], active: '1' },
		},
	}
	localStorage.setItem('timer-list', JSON.stringify(saved))
	const store = createStore()
	expect(store.peek(activeListAtom)).toEqual(saved.lists.second)
	store.send(allListAtom, tag('activateItem', { target: '0' }))
	expect(store.peek(allListAtom).active).toBe('second')
	expect(store.peek(activeAtom).id).toBe('1')
})

test('restores unnamed lists and persists renaming without changing timers', async () => {
	const list = { items: [{ id: '0', duration: 1_000 }], active: '0' }
	localStorage.setItem(
		'timer-list',
		JSON.stringify({
			nextItemId: 1,
			nextListId: 1,
			active: '0',
			lists: { '0': list },
		}),
	)
	const store = createStore()
	expect(store.peek(activeListAtom).name).toBe('')
	for (const name of ['Tea', '']) {
		store.send(allListAtom, tag('renameList', { list: '0', name }))
		await Promise.resolve()
		expect(store.peek(activeListAtom)).toEqual({ ...list, name })
		expect(
			JSON.parse(localStorage.getItem('timer-list')!).lists['0'].name,
		).toBe(name)
	}
})

test('activating a list stops the timer and preserves elapsed time and list items', async () => {
	const lists = {
		'0': { name: 'First', items: [{ id: '0', duration: 5_000 }], active: '0' },
		'1': {
			name: 'Second',
			items: [{ id: '1', duration: 10_000 }],
			active: '1',
		},
	}
	localStorage.setItem(
		'timer-list',
		JSON.stringify({
			nextItemId: 2,
			nextListId: 2,
			active: '0',
			lists,
		}),
	)
	const store = createStore()
	store.send(timeAtom, 0)
	await Promise.resolve()
	store.send(runningAtom, true)
	await Promise.resolve()
	store.send(timeAtom, 1_000)
	await Promise.resolve()
	store.send(activateListAtom, '1')
	await Promise.resolve()
	expect(store.peek(allListAtom)).toEqual({
		nextItemId: 2,
		nextListId: 2,
		active: '1',
		lists,
	})
	expect(store.peek(activeListAtom)).toEqual(lists['1'])
	expect(store.peek(runningAtom)).toBe(false)
	expect(store.peek(timerAtom)).toEqual(tag('idle', { elapsed: 1_000 }))
	await Promise.resolve()
	expect(JSON.parse(localStorage.getItem('timer-list')!).active).toBe('1')

	store.send(runningAtom, true)
	await Promise.resolve()
	store.send(activateListAtom, '1')
	await Promise.resolve()
	expect(store.peek(runningAtom)).toBe(false)
	expect(() => store.send(activateListAtom, 'missing')).toThrow()
	expect(store.peek(allListAtom).active).toBe('1')
})

test.each([clearListAtom, removeListAtom])(
	'clearing or removing the current list stops and resets the timer',
	async (action) => {
		const store = createStore()
		store.send(allListAtom, tag('renameList', { list: '0', name: 'Tea' }))
		await Promise.resolve()
		store.send(allListAtom, tag('cloneList', { list: '0' }))
		await Promise.resolve()
		store.send(timeAtom, 0)
		await Promise.resolve()
		store.send(runningAtom, true)
		await Promise.resolve()
		store.send(timeAtom, 500)
		await Promise.resolve()
		store.send(action, '0')
		await Promise.resolve()
		expect(store.peek(runningAtom)).toBe(false)
		expect(store.peek(timerAtom)).toEqual(tag('idle', { elapsed: 0 }))
		const state = store.peek(allListAtom)
		expect(state.lists[state.active]).toBeDefined()
		expect(state.lists['1']!.name).toBe('Tea')
		if (action === removeListAtom) {
			expect(state.active).toBe('1')
			expect(state.lists['0']).toBeUndefined()
		} else {
			expect(state.active).toBe('0')
			expect(state.lists['0']!.items).toEqual([{ id: '2', duration: 0 }])
		}
		expect(JSON.parse(localStorage.getItem('timer-list')!)).toEqual(state)
	},
)
