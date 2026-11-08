import { describe, expect, it } from 'vitest'

import { derivedAtom, type AtomSymbol } from '.'
import { createStore, flushMicrotask, inspect } from './utils.testing'

function chain(size: number, events: number[]) {
	let head: AtomSymbol<number, never> = derivedAtom(() => 0, undefined, {
		onMount: () => {
			events.push(0)
		},
	})
	for (let index = 1; index < size; index++) {
		const dependency = head
		head = derivedAtom((read) => read(dependency) + 1, undefined, {
			onMount: () => {
				events.push(index)
			},
		})
	}
	return head
}

describe('mount traversal cost', () => {
	it.each([16, 32, 64])(
		'mounts a fresh %i-node chain with linear traversal work',
		async (size) => {
			const events: number[] = []
			const head = chain(size, events)
			const store = createStore()
			store.subscribe(head, () => {})
			const before = inspect(store).mountWalks

			await flushMicrotask()

			expect(events).toEqual(Array.from({ length: size }, (_, index) => index))
			const walks = inspect(store).mountWalks - before
			expect(walks).toBeGreaterThanOrEqual(size)
			expect(walks).toBeLessThanOrEqual(3 * size)
		},
	)

	it.each([16, 32, 64])(
		'shares a mounted %i-node chain across queued roots with linear traversal work',
		async (size) => {
			const events: number[] = []
			const head = chain(size, events)
			const store = createStore()
			store.subscribe(head, () => {})
			await flushMicrotask()
			const roots = Array.from({ length: size }, () =>
				derivedAtom((read) => read(head)),
			)
			for (const root of roots) store.subscribe(root, () => {})
			const before = inspect(store).mountWalks

			await flushMicrotask()

			expect(events).toHaveLength(size)
			const walks = inspect(store).mountWalks - before
			expect(walks).toBeGreaterThanOrEqual(size)
			expect(walks).toBeLessThanOrEqual(3 * size)
		},
	)
})
