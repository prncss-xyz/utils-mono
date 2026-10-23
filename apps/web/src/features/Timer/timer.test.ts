import { createStore } from '@prncss-xyz/react-utils'
import { expect, test } from 'vitest'

import { timeAtom } from './time'
import { elapsedTimeAtom, resetAtom, runningAtom } from './timer'

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
	expect(store.peek(elapsedTimeAtom)).toBe(1_000)

	store.send(resetAtom, undefined)
	store.send(runningAtom, true)
	await Promise.resolve()
	expect(store.peek(runningAtom)).toBe(true)
	expect(store.peek(elapsedTimeAtom)).toBe(0)

	store.send(timeAtom, 1_500)
	await Promise.resolve()
	store.send(runningAtom, false)
	await Promise.resolve()
	store.send(timeAtom, 2_000)
	await Promise.resolve()
	store.send(runningAtom, true)
	await Promise.resolve()
	expect(store.peek(runningAtom)).toBe(true)
	expect(store.peek(elapsedTimeAtom)).toBe(500)
})
