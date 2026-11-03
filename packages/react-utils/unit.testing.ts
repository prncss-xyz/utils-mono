import type { TestUserConfig } from 'vite-plus'

export const unitTestConfig = {
	environment: 'node',
	globals: true,
	include: ['**/*.test.ts'],
	name: 'unit',
} satisfies TestUserConfig
