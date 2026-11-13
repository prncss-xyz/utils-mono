import { describe, it } from 'vitest'

import { StoreProvider } from './react'
import { createStore, primitiveAtom } from './store'

const count = primitiveAtom(0)

describe('StoreProvider typing', () => {
	it('accepts either a store or hydration entries', () => {
		const store = createStore()
		StoreProvider({ children: null })
		StoreProvider({ children: null, store })
		StoreProvider({ children: null, hydrate: [[count, 1]] })
	})

	it('rejects a store together with hydration entries', () => {
		const store = createStore()
		// @ts-expect-error a provided store cannot also be hydrated
		StoreProvider({ children: null, store, hydrate: [[count, 1]] })
		// @ts-expect-error an empty hydration list is still exclusive with a store
		StoreProvider({ children: null, store, hydrate: [] })
	})
})
