import { expect, test } from 'vite-plus/test'

import { For, Show } from '../src/index.ts'

test('exports the React utilities', () => {
	expect(For).toBeTypeOf('function')
	expect(Show).toBeTypeOf('function')
})
