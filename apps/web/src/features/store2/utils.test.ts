import { describe, expect, it } from 'vitest'

import { sortedPush, sortedRemove } from './utils'

type IndexedValue = { symbol: { index: number } }

function createValues(indexes: number[]): IndexedValue[] {
	return indexes.map((index) => ({ symbol: { index } }))
}

function readIndexes(values: IndexedValue[]) {
	return values.map(({ symbol }) => symbol.index)
}

describe('sortedRemove', () => {
	it('removes a value by symbol index in place', () => {
		const values = createValues([1, 2, 3])

		sortedRemove(values, { symbol: { index: 2 } })

		expect(readIndexes(values)).toEqual([1, 3])
	})

	it('does nothing when the symbol index is not found', () => {
		const values = createValues([1, 3])

		sortedRemove(values, { symbol: { index: 2 } })

		expect(readIndexes(values)).toEqual([1, 3])
	})
})

describe('sortedPush', () => {
	it('inserts into an empty array in place', () => {
		const values = createValues([])
		const inserted = { symbol: { index: 2 } }

		sortedPush(values, inserted)

		expect(values).toEqual([inserted])
	})

	it('inserts before the first value', () => {
		const values = createValues([2, 3])

		sortedPush(values, { symbol: { index: 1 } })

		expect(readIndexes(values)).toEqual([1, 2, 3])
	})

	it('inserts between existing values', () => {
		const values = createValues([1, 3, 4])

		sortedPush(values, { symbol: { index: 2 } })

		expect(readIndexes(values)).toEqual([1, 2, 3, 4])
	})

	it('inserts after the last value', () => {
		const values = createValues([1, 2])

		sortedPush(values, { symbol: { index: 3 } })

		expect(readIndexes(values)).toEqual([1, 2, 3])
	})

	it('does not insert when a value has the same symbol index', () => {
		const values = createValues([1, 2, 3])
		const existing = values[1]

		sortedPush(values, { symbol: { index: 2 } })

		expect(readIndexes(values)).toEqual([1, 2, 3])
		expect(values[1]).toBe(existing)
	})
})
