import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vite-plus'

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
					executablePath: existsSync('/usr/bin/chromium')
						? '/usr/bin/chromium'
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
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	fmt: {},
	test: {
		projects: [{ extends: true, ...storybookTestProject }],
	},
})
