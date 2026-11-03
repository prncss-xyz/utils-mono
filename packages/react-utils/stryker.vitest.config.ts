import { defineConfig } from 'vite-plus'

import { unitTestConfig } from './unit.testing'

export default defineConfig({
	test: {
		...unitTestConfig,
		setupFiles: ['./stryker.setup.testing.ts'],
	},
})
