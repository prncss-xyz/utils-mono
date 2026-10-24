import { defineConfig } from 'vite-plus'

import fmt from './oxfmt.config'
import lint from './oxlint.config'
import {
	canRunBrowserTests,
	storybookTestProject,
} from './packages/react-utils/vite.config'

export default defineConfig({
	staged: {
		'*': 'vp check --fix',
	},
	fmt,
	lint,
	run: {
		tasks: {
			verify: {
				command: 'true',
				dependsOn: ['sherif', 'tsc', 'vp:test:changed', 'knip', 'build'],
			},
			ci: {
				command: 'true',
				dependsOn: [
					'check',
					'sherif',
					'typos',
					'tsc',
					'vp:test',
					'knip',
					'build',
				],
			},
			'vp:test': {
				command: 'vp test',
				cache: {
					input: [{ auto: true }, '!node_modules/.cache/storybook/**'],
					output: [{ auto: true }, '!node_modules/.cache/storybook/**'],
				},
			},
			'vp:test:changed': {
				command: 'vp test --changed',
				cache: {
					input: [{ auto: true }, '!node_modules/.cache/storybook/**'],
					output: [{ auto: true }, '!node_modules/.cache/storybook/**'],
				},
			},
		},
	},
	test: {
		projects: [
			{
				test: {
					name: 'web-unit',
					environment: 'node',
					include: ['apps/web/**/*.test.ts'],
				},
			},
			{
				test: {
					environment: 'node',
					globals: true,
					include: ['packages/react-utils/**/*.test.ts'],
					name: 'unit',
				},
			},
			...(canRunBrowserTests
				? [
						{
							extends: './packages/react-utils/vite.config.ts',
							...storybookTestProject,
						},
					]
				: []),
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
