import { fc, test } from '@fast-check/vitest'
import { isoAssert, RESET } from '@prncss-xyz/react-utils'
import { expect } from 'vitest'

import { create, remove, type ListState } from './operations'

const stateArbitrary = fc
	.array(fc.integer({ min: 0, max: 86_400 }), { minLength: 1, maxLength: 50 })
	.chain((durations) =>
		fc.record({
			items: fc.constant(
				durations.map((duration, index) => ({ id: String(index), duration })),
			),
			nextId: fc.integer({ min: durations.length, max: 1_000_000 }),
			active: fc.integer({ min: 0, max: durations.length - 1 }).map(String),
			index: fc.integer({ min: 0, max: durations.length - 1 }),
		}),
	)

const freezeState = (state: ListState & { index: number }) => {
	for (const item of state.items) Object.freeze(item)
	Object.freeze(state.items)
	return Object.freeze(state)
}

test.prop([stateArbitrary])(
	'create inserts an independent copy after its source and allocates a unique ID',
	(input) => {
		const state = freezeState(input)
		const source = state.items[state.index]!
		const result = create({ source: source.id }, state)
		expect(result.nextId).toBe(state.nextId + 1)
		expect(result.items).toHaveLength(state.items.length + 1)
		expect(result.items[state.index + 1]).toEqual({
			...source,
			id: String(state.nextId),
		})
		expect(result.items[state.index + 1]).not.toBe(source)
		expect(
			result.items.filter((item) => item.id !== String(state.nextId)),
		).toEqual(state.items)
		expect(new Set(result.items.map(({ id }) => id)).size).toBe(
			result.items.length,
		)
	},
)

test.prop([stateArbitrary])(
	'remove preserves survivor order and chooses a valid active timer or resets the last timer',
	(input) => {
		const state = freezeState(input)
		const target = state.items[state.index]!.id
		const result = remove({ target }, state)
		if (state.items.length === 1) {
			expect(result).toBe(RESET)
			return
		}
		isoAssert(result !== RESET, 'Unexpected reset')
		expect(result.items).toEqual(state.items.filter(({ id }) => id !== target))
		const expectedActive =
			state.active !== target
				? state.active
				: (state.items[state.index + 1] ?? state.items[state.index - 1])!.id
		expect(result.active).toBe(expectedActive)
		expect(result.items.some(({ id }) => id === result.active)).toBe(true)
	},
)

test.prop([stateArbitrary])(
	'creating and then removing the copy restores the original items and active selection',
	(input) => {
		const state = freezeState(input)
		const created = create({ source: state.items[state.index]!.id }, state)
		expect(
			remove({ target: String(state.nextId) }, { ...state, ...created }),
		).toEqual({ items: state.items, active: state.active })
	},
)
