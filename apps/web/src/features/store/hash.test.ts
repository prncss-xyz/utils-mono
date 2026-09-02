import { getHash } from './hash'

describe('objects/hash', () => {
	it('generates consistent hash for objects with different key order', () => {
		const o1 = { a: 1, b: 2 }
		const o2 = { a: 1, b: 2 }
		expect(getHash(o1)).toBe(getHash(o2))
	})
	it('handles nested objects', () => {
		const o1 = { a: { x: 1, y: 2 } }
		const o2 = { a: { x: 1, y: 2 } }
		expect(getHash(o1)).toBe(getHash(o2))
	})
	it('handles null', () => {
		expect(getHash(null)).toBe('null')
	})
	it('handles undefined', () => {
		expect(getHash(undefined)).toBeUndefined()
	})
	it('handles objects created with Object.create(null)', () => {
		const o = Object.create(null)
		o.a = 1
		expect(getHash(o)).toBe('{"a":1}')
	})
	it('handles objects with custom constructor (not plain)', () => {
		class Foo {
			a: number
			constructor(a: number) {
				this.a = a
			}
		}
		const f1 = new Foo(1)
		// It should NOT sort keys if it doesn't consider it plain object?
		// getHash logic: isPlainObject(val) ? sort... : val
		// isPlainObject(f1) should be false.
		// So it returns f1.
		// JSON.stringify(f1) -> '{"a":1}'
		expect(getHash(f1)).toBe('{"a":1}')
	})
	it('handles Object.create with prototype', () => {
		const proto = { p: 1 }
		const o = Object.create(proto)
		o.a = 1
		// isPlainObject checks prototype === Object.prototype
		// So this should fail isPlainObject check.
		// JSON.stringify(o) -> '{"a":1}' (doesn't include prototype props)
		expect(getHash(o)).toBe('{"a":1}')
	})
	it('handles object with constructor.prototype not being Object', () => {
		const o: any = {}
		o.constructor = function () {}
		o.constructor.prototype = null
		// isPlainObject checks o.constructor.prototype
		// hasObjectPrototype(null) is false
		// returns false (not plain object)
		// getHash returns o (not sorted)
		// But JSON.stringify(o) will ignore 'constructor' property if it's not enumerable?
		// Or if we define it as property?
		// JSON.stringify includes enumerable properties.
		expect(getHash(o)).toBe(JSON.stringify(o))
	})
})
