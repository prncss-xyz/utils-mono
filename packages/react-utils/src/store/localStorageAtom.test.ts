import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { localStorageAtom } from './localStorageAtom'
import { createStore } from './store'
import { flushMicrotask } from './store/utils.testing'

beforeEach(() => {
	const values = new Map<string, string>()
	vi.stubGlobal('window', new EventTarget())
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	})
})

afterEach(() => vi.unstubAllGlobals())

it('reads storage and persists direct and consecutive functional updates', async () => {
	localStorage.setItem('count', '2')
	const atom = localStorageAtom<number>('count', (raw) => Number(raw), String)
	const store = createStore()
	expect(store.peek(atom)).toBe(2)
	store.send(atom, 4)
	store.send(atom, (value) => value + 1)
	store.send(atom, (value) => value + 1)
	await flushMicrotask()
	expect(store.peek(atom)).toBe(6)
	expect(localStorage.getItem('count')).toBe('6')
})

it('synchronizes stores, browser events, removals, and changes before mounting', async () => {
	const atom = localStorageAtom('name', (raw) => raw ?? 'default')
	const first = createStore()
	const second = createStore()
	expect(first.peek(atom)).toBe('default')
	localStorage.setItem('name', 'before mount')
	const unsubscribeFirst = first.subscribe(atom, vi.fn())
	const unsubscribeSecond = second.subscribe(atom, vi.fn())
	await flushMicrotask()
	await flushMicrotask()
	expect(first.peek(atom)).toBe('before mount')
	first.send(atom, 'updated')
	await flushMicrotask()
	expect(second.peek(atom)).toBe('updated')
	localStorage.setItem('name', 'other tab')
	window.dispatchEvent(new Event('storage'))
	await flushMicrotask()
	expect(first.peek(atom)).toBe('other tab')
	localStorage.removeItem('name')
	window.dispatchEvent(new Event('local-storage-update'))
	await flushMicrotask()
	expect(second.peek(atom)).toBe('default')
	unsubscribeFirst()
	unsubscribeSecond()
	const read = vi.spyOn(localStorage, 'getItem')
	window.dispatchEvent(new Event('storage'))
	expect(read).not.toHaveBeenCalled()
})

it('falls back to null when storage is unavailable', () => {
	vi.stubGlobal('localStorage', undefined)
	vi.stubGlobal('window', undefined)
	const atom = localStorageAtom('name', (raw) => raw ?? 'server')
	expect(createStore().peek(atom)).toBe('server')
})

it('keeps storage listeners attached across value changes', async () => {
	const add = vi.spyOn(window, 'addEventListener')
	const remove = vi.spyOn(window, 'removeEventListener')
	const atom = localStorageAtom('name', (raw) => raw ?? '')
	const store = createStore()
	const unsubscribe = store.subscribe(atom, vi.fn())
	await flushMicrotask()
	store.send(atom, 'changed')
	await flushMicrotask()
	store.send(atom, 'again')
	await flushMicrotask()
	expect(add).toHaveBeenCalledTimes(2)
	expect(remove).not.toHaveBeenCalled()
	unsubscribe()
	expect(remove).toHaveBeenCalledTimes(2)
})
