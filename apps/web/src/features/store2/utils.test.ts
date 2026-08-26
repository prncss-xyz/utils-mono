import { describe, expect, it } from 'vitest'

import { addScope, sortedPush, sortedRemove } from './utils'

function readIndexes(values: { index: number }[]) {
	return values.map(({ index }) => index)
}

function createIndexes(indexes: number[]) {
	return indexes.map((index) => ({ index }))
}

function createScope(indexes: number[]) {
	return indexes.map((index) => [{ index }, index] as [{ index: number }, unknown])
}

function readBindings(scope: [{ index: number }, unknown][]) {
	return scope.map(([key, value]) => [key.index, value])
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

describe('addScope', () => {
	it('adds a binding to an empty scope', () => {
		const scope = createScope([])

		addScope(scope, { index: 2 }, 'v')

		expect(readBindings(scope)).toEqual([[2, 'v']])
	})

	it('inserts before the first binding', () => {
		const scope = createScope([2, 3])

		addScope(scope, { index: 1 }, 'v')

		expect(readBindings(scope)).toEqual([
			[1, 'v'],
			[2, 2],
			[3, 3],
		])
	})

	it('inserts between existing bindings', () => {
		const scope = createScope([1, 3, 4])

		addScope(scope, { index: 2 }, 'v')

		expect(readBindings(scope)).toEqual([
			[1, 1],
			[2, 'v'],
			[3, 3],
			[4, 4],
		])
	})

	it('appends after the last binding', () => {
		const scope = createScope([1, 2])

		addScope(scope, { index: 3 }, 'v')

		expect(readBindings(scope)).toEqual([
			[1, 1],
			[2, 2],
			[3, 'v'],
		])
	})

	it('keeps the existing binding untouched when the value is equal', () => {
		const scope = createScope([1, 2, 3])
		const existing = scope.find(([key]) => key.index === 2)![1]

		addScope(scope, { index: 2 }, existing)

		expect(scope).toHaveLength(3)
		expect(readBindings(scope)).toEqual([
			[1, 1],
			[2, 2],
			[3, 3],
		])
	})

	it('treats existing equal values by reference as a no-op', () => {
		const value = { nested: true }
		const scope: [{ index: number }, unknown][] = [
			[{ index: 1 }, value],
			[{ index: 3 }, 'c'],
		]

		addScope(scope, { index: 1 }, value)

		expect(scope).toHaveLength(2)
		expect(scope[0]![1]).toBe(value)
	})

	it('throws when the index is bound to a different value', () => {
		const scope = createScope([1, 2, 3])

		expect(() => addScope(scope, { index: 2 }, 'different')).toThrow(
			'Atom 2 is already bound to a different value',
		)
	})

	it('does not mutate the scope when throwing', () => {
		const scope = createScope([1, 2])

		expect(() => addScope(scope, { index: 2 }, 'different')).toThrow()

		expect(readBindings(scope)).toEqual([
			[1, 1],
			[2, 2],
		])
	})
})
