import { tag } from './tag'

describe('tag', () => {
	test('a single tag has an undefined payload', () => {
		const t = tag('a')
		expect(t).toStrictEqual({ type: 'a', payload: undefined })
		expectTypeOf(t).toEqualTypeOf<{ type: 'a'; payload: undefined }>()
	})

	test('a simple tag with two arguments', () => {
		const t = tag('a', 1)
		expect(t).toStrictEqual({ type: 'a', payload: 1 })
		expectTypeOf(t).toEqualTypeOf<{ type: 'a'; payload: 1 }>()
	})

	test('nests two tags around a payload', () => {
		const t = tag('a', 'b', 'c')
		expect(t).toStrictEqual({
			type: 'a',
			payload: { type: 'b', payload: 'c' },
		})
		expectTypeOf(t).toEqualTypeOf<{
			type: 'a'
			payload: { type: 'b'; payload: 'c' }
		}>()
	})
})
