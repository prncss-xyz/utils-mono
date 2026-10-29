import { shallowEqual } from './shallow-equal'

describe('shallowEqual', () => {
	test('basic', () => {
		expect(shallowEqual(1, 1)).toBeTruthy()
		expect(shallowEqual(1, [])).toBeFalsy()
		expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBeFalsy()
		expect(shallowEqual({ a: 1, b: undefined }, { a: 1 })).toBeFalsy()
		expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBeFalsy()
		expect(shallowEqual({ a: 1 }, { a: 2 })).toBeFalsy()
		expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeTruthy()
		expect(shallowEqual([0, 1], [0, 1])).toBeTruthy()
		expect(shallowEqual([0, 1], [0, 2])).toBeFalsy()
		expect(shallowEqual([0, 1, 2], [0, 1])).toBeFalsy()
		expect(shallowEqual([0, 1], [0, 1, 2])).toBeFalsy()
	})
})
