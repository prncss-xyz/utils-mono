import { describe, it } from 'vitest'

import { atomFamily, primitiveAtom } from './store'

describe('family options typing', () => {
	it('rejects hash together with eq', () => {
		atomFamily((key: string[]) => primitiveAtom(key.length), {
			hash: (key: string[]) => key.join(),
			// @ts-expect-error hash and eq are mutually exclusive
			eq: (a: string[], b: string[]) => a.length === b.length,
		})
	})
})
