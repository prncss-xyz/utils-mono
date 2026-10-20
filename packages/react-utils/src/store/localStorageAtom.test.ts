import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { localStorageAtom } from './localStorageAtom'
import { createStore } from './store'

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
	await Promise.resolve()
	expect(store.peek(atom)).toBe(6)
	expect(localStorage.getItem('count')).toBe('6')
})

it('synchronizes stores, browser events, removals, and changes before mounting', async () => {
	const atom = localStorageAtom('name', (raw) => raw ?? 'default')
	const first = createStore()
	const second = createStore()
	expect(first.peek(atom)).toBe('default')
	localStorage.setItem('name', 'before mount')
	const releaseFirst = first.subscribe(atom, vi.fn())
	const releaseSecond = second.subscribe(atom, vi.fn())
	await Promise.resolve()
	await Promise.resolve()
	expect(first.peek(atom)).toBe('before mount')
	first.send(atom, 'updated')
	await Promise.resolve()
	expect(second.peek(atom)).toBe('updated')
	localStorage.setItem('name', 'other tab')
	window.dispatchEvent(new Event('storage'))
	await Promise.resolve()
	expect(first.peek(atom)).toBe('other tab')
	localStorage.removeItem('name')
	window.dispatchEvent(new Event('local-storage-update'))
	await Promise.resolve()
	expect(second.peek(atom)).toBe('default')
	releaseFirst()
	releaseSecond()
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
	const release = store.subscribe(atom, vi.fn())
	await Promise.resolve()
	store.send(atom, 'changed')
	await Promise.resolve()
	store.send(atom, 'again')
	await Promise.resolve()
	expect(add).toHaveBeenCalledTimes(2)
	expect(remove).not.toHaveBeenCalled()
	release()
	expect(remove).toHaveBeenCalledTimes(2)
})
