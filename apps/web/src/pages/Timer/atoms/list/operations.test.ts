import { fc, test } from '@fast-check/vitest'
import { expect } from 'vitest'

import {
	activateItem,
	clone,
	cloneList,
	removeList,
	remove,
	renameList,
	clearList,
	update,
} from './operations'

const stateArbitrary = fc
	.array(fc.integer({ min: 0, max: 86_400 }), { minLength: 1, maxLength: 50 })
	.chain((durations) =>
		fc.record({
			items: fc.constant(
				durations.map((duration, index) => ({ id: String(index), duration })),
			),
			nextItemId: fc.integer({ min: durations.length, max: 1_000_000 }),
			active: fc.integer({ min: 0, max: durations.length - 1 }).map(String),
			index: fc.integer({ min: 0, max: durations.length - 1 }),
		}),
	)

test.prop([stateArbitrary])(
	'operations find items across lists and preserve unrelated lists',
	(input) => {
		const { items, active, nextItemId, index } = input
		const other = {
			name: 'Other',
			items: [{ id: 'other', duration: 500 }],
			active: 'other',
		}
		const state = {
			nextItemId,
			nextListId: 2,
			active: 'other',
			lists: { other, target: { name: 'Target', items, active } },
		}
		for (const name of ['Renamed', '']) {
			const renamed = renameList({ list: 'target', name }, state)
			expect(renamed.lists.target).toEqual({ ...state.lists.target, name })
			expect(renamed.lists.other).toBe(other)
		}
		const listClone = cloneList({ list: 'target' }, state)
		const copied = listClone.lists['2']!
		expect(listClone.nextListId).toBe(3)
		expect(listClone.nextItemId).toBe(nextItemId + items.length)
		expect(copied.name).toBe('Target')
		expect(copied.items.map(({ duration }) => duration)).toEqual(
			items.map(({ duration }) => duration),
		)
		expect(
			new Set(
				Object.values(listClone.lists).flatMap(({ items }) =>
					items.map(({ id }) => id),
				),
			).size,
		).toBe(items.length * 2 + 1)
		expect(copied.items.findIndex(({ id }) => id === copied.active)).toBe(
			items.findIndex(({ id }) => id === active),
		)
		expect(listClone.lists.target).toBe(state.lists.target)
		expect(removeList({ list: 'target' }, state)).toEqual({
			active: 'other',
			lists: { other },
		})
		expect(removeList({ list: 'other' }, state)).toEqual({
			active: 'target',
			lists: { target: state.lists.target },
		})
		const onlyList = {
			...state,
			active: 'target',
			lists: { target: state.lists.target },
		}
		expect(removeList({ list: 'target' }, onlyList)).toEqual(
			clearList({ list: 'target' }, onlyList),
		)
		const source = items[index]!
		const cloned = clone({ source: source.id }, state)
		expect(cloned.nextItemId).toBe(nextItemId + 1)
		expect(cloned.lists.other).toBe(other)
		expect(cloned.lists.target!.items[index + 1]).toEqual({
			...source,
			id: String(nextItemId),
		})
		expect(
			remove({ target: String(nextItemId) }, { ...state, ...cloned }).lists,
		).toEqual(state.lists)
		const updated = update({ target: source.id, duration: 42 }, state)
		expect(updated.lists.target!.items[index]!.duration).toBe(42)
		expect(updated.lists.other).toBe(other)
		const activated = activateItem({ target: source.id }, state)
		expect(activated.lists.target!.active).toBe(source.id)
		expect(activated.lists.other).toBe(other)
		const removed = remove({ target: source.id }, state)
		expect(removed.lists.other).toBe(other)
		const remaining = removed.lists.target!
		expect(remaining.items.some(({ id }) => id === remaining.active)).toBe(true)
		if (items.length === 1) {
			expect(removed).toEqual(clearList({ list: 'target' }, state))
			expect(remaining.items).toEqual([{ id: String(nextItemId), duration: 0 }])
		} else {
			expect(remaining.items).toEqual(
				items.filter(({ id }) => id !== source.id),
			)
			expect(remaining.active).toBe(
				active === source.id
					? (items[index + 1] ?? items[index - 1])!.id
					: active,
			)
		}
		const cleared = clearList({ list: 'target' }, state)
		expect(cleared.nextItemId).toBe(nextItemId + 1)
		expect(cleared.lists.other).toBe(other)
		expect(cleared.lists.target).toEqual({
			name: 'Target',
			items: [{ id: String(nextItemId), duration: 0 }],
			active: String(nextItemId),
		})
	},
)
