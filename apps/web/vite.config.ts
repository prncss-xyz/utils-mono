import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import babel from '@rolldown/plugin-babel'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
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
					// on a local machine, we rely on what is installed
					executablePath: existsSync('/usr/bin/chromium')
						? '/usr/bin/chromium'
						: undefined,
				},
			}),
		},
	},
}

const basepath = (process.env.VITE_BASE_PATH ?? '') + '/'

const config = defineConfig({
	base: basepath,
	resolve: { tsconfigPaths: true },
	plugins: [viteReact(), babel({ presets: [reactCompilerPreset()] })],
	run: {
		tasks: {
			'vp:tsc': 'tsc --noEmit',
		},
	},
	test: {
		projects: [{ extends: true, ...storybookTestProject }],
	},
})

export default config
