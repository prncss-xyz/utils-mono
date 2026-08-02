import { defineConfig } from 'vite-plus'

import lint, { ignorePatterns } from './oxlint.config'
import { storybookTestProject } from './packages/react-utils/vite.config'

export default defineConfig({
	staged: {
		'*': 'vp check --fix',
	},
	fmt: {
		arrowParens: 'always',
		ignorePatterns,
		jsxSingleQuote: true,
		printWidth: 80,
		semi: false,
		singleQuote: true,
		sortImports: true,
		sortPackageJson: true,
		trailingComma: 'all',
		useTabs: true,
	},
	lint,
	run: {
		tasks: {
			verify: {
				command: 'true',
				dependsOn: ['sherif', 'tsc', 'vp:test:changed', 'knip', 'build'],
			},
			ci: {
				command: 'true',
				dependsOn: ['check', 'sherif', 'tsc', 'vp:test', 'knip', 'build'],
			},
			'vp:test': {
				command: 'vp test',
				input: [{ auto: true }, '!node_modules/.cache/storybook/**'],
				output: [{ auto: true }, '!node_modules/.cache/storybook/**'],
			},
			'vp:test:changed': {
				command: 'vp test --changed',
				input: [{ auto: true }, '!node_modules/.cache/storybook/**'],
				output: [{ auto: true }, '!node_modules/.cache/storybook/**'],
			},
		},
	},
	test: {
		projects: [
			{
				extends: './packages/react-utils/vite.config.ts',
				...storybookTestProject,
			},
		],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json'],
		},
		globals: true,
		passWithNoTests: true,
		pool: 'forks',
	},
})
