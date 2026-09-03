import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vite-plus'

const systemChromium = '/usr/bin/chromium'

const hasRuntimeGlibc = () => {
	const report = process.report?.getReport()
	const header = report && 'header' in report ? report.header : undefined

	return Boolean(
		header &&
		typeof header === 'object' &&
		'glibcVersionRuntime' in header &&
		header.glibcVersionRuntime,
	)
}

export const canRunBrowserTests =
	process.platform !== 'linux' ||
	hasRuntimeGlibc() ||
	existsSync(systemChromium)

export const storybookTestProject = {
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [
		storybookTest({
			configDir: fileURLToPath(new URL('./.storybook', import.meta.url)),
			storybookScript: `pnpm --dir ${fileURLToPath(new URL('.', import.meta.url))} storybook --no-open`,
		}),
	],
	test: {
		name: 'storybook',
		browser: {
			enabled: true,
			headless: true,
			instances: [{ browser: 'chromium' as const }],
			provider: playwright({
				launchOptions: {
					executablePath: existsSync(systemChromium)
						? systemChromium
						: undefined,
				},
			}),
		},
	},
}

export default defineConfig({
	pack: {
		dts: {
			tsgo: true,
		},
		exports: true,
	},
	test: {
		projects: canRunBrowserTests
			? [{ extends: true, ...storybookTestProject }]
			: [
					{
						test: {
							environment: 'node',
							globals: true,
							include: ['**/*.test.ts'],
							name: 'unit',
						},
					},
				],
	},
})
