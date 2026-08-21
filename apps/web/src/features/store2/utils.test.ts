import { describe, expect, it } from 'vitest'

import { sortedPush, sortedRemove } from './utils'

function readIndexes(values: { index: number }[]) {
	return values.map(({ index }) => index)
}

function createIndexes(indexes: number[]) {
	return indexes.map((index) => ({ index }))
}

describe('sortedRemove', () => {
	it('removes a value by index in place', () => {
		const values = createIndexes([1, 2, 3])

		sortedRemove(values, { index: 2 })

		expect(readIndexes(values)).toEqual([1, 3])
	})

	it('does nothing when the index is not found', () => {
		const values = createIndexes([1, 3])

		sortedRemove(values, { index: 2 })

		expect(readIndexes(values)).toEqual([1, 3])
	})
})

describe('sortedPush', () => {
	it('inserts into an empty array in place', () => {
		const values = createIndexes([])
		const inserted = { index: 2 }

		sortedPush(values, inserted)

		expect(values).toEqual([inserted])
	})

	it('inserts before the first value', () => {
		const values = createIndexes([2, 3])

		sortedPush(values, { index: 1 })

		expect(readIndexes(values)).toEqual([1, 2, 3])
	})

	it('inserts between existing values', () => {
		const values = createIndexes([1, 3, 4])

		sortedPush(values, { index: 2 })

		expect(readIndexes(values)).toEqual([1, 2, 3, 4])
	})

	it('inserts after the last value', () => {
		const values = createIndexes([1, 2])

		sortedPush(values, { index: 3 })

		expect(readIndexes(values)).toEqual([1, 2, 3])
	})

	it('does not insert when a value has the same index', () => {
		const values = createIndexes([1, 2, 3])

		sortedPush(values, { index: 2 })

		expect(readIndexes(values)).toEqual([1, 2, 3])
	})
})
