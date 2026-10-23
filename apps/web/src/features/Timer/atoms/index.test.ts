import { createStore, tag, toggle } from '@prncss-xyz/react-utils'
import { expect, test } from 'vitest'

import { activeAtom, fulfilledAtom, runningAtom, timerDisplayAtom } from '.'
import { listAtom } from './list'
import { timeAtom } from './time'

test('restarts a stopped timer from zero and resumes paused timers', async () => {
	const store = createStore()
	store.send(timeAtom, 0)
	await Promise.resolve()
	store.send(runningAtom, true)
	await Promise.resolve()
	store.send(timeAtom, 1_000)
	await Promise.resolve()
	store.send(runningAtom, false)
	await Promise.resolve()
	expect(store.peek(fulfilledAtom)).toBe(true)
	expect(store.peek(timerDisplayAtom)).toBe('00:00:00')

	store.send(runningAtom, toggle)
	await Promise.resolve()
	expect(store.peek(runningAtom)).toBe(true)
	expect(store.peek(fulfilledAtom)).toBe(false)
	expect(store.peek(timerDisplayAtom)).toBe('00:00:01')

	store.send(timeAtom, 1_500)
	await Promise.resolve()
	store.send(runningAtom, false)
	await Promise.resolve()
	store.send(timeAtom, 2_000)
	await Promise.resolve()
	store.send(runningAtom, true)
	await Promise.resolve()
	expect(store.peek(runningAtom)).toBe(true)
	expect(store.peek(fulfilledAtom)).toBe(false)
	store.send(timeAtom, 2_500)
	await Promise.resolve()
	expect(store.peek(fulfilledAtom)).toBe(true)
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
