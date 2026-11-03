import { describe, expectTypeOf, it } from 'vitest'

import {
	atomFamily,
	createStore,
	hydrate,
	primitiveAtom,
	type Store,
} from './store'

const count = primitiveAtom(0)
const members = atomFamily((key: string) => primitiveAtom(key.length))

describe('hydration typing', () => {
	it('accepts entries matching atom events and family keys', () => {
		expectTypeOf(createStore([[count, 4]])).toEqualTypeOf<Store>()
		expectTypeOf(createStore([[members, 'first', 10]])).toEqualTypeOf<Store>()
		expectTypeOf(
			createStore([hydrate(count, 4), hydrate(members, 'first', 10)]),
		).toEqualTypeOf<Store>()
	})

	it('rejects entries that do not match', () => {
		// @ts-expect-error count events must correspond to its number state
		createStore([[count, 'invalid']])
		// @ts-expect-error family keys must correspond to the family key type
		createStore([[members, 123, 10]])
		// @ts-expect-error family events must correspond to the member event type
		createStore([[members, 'first', 'invalid']])
		// @ts-expect-error reusable atom hydration entries validate their event
		hydrate(count, 'invalid')
		// @ts-expect-error reusable family hydration entries validate their key
		hydrate(members, 123, 10)
		// @ts-expect-error reusable family hydration entries validate their event
		hydrate(members, 'first', 'invalid')
	})
})
