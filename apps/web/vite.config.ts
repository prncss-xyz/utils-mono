import { existsSync } from 'node:fs'

import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vite-plus'

const basepath = (process.env.VITE_BASE_PATH ?? '') + '/'

const config = defineConfig({
	base: basepath,
	optimizeDeps: {
		exclude: ['@astryxdesign/core'],
	},
	resolve: { tsconfigPaths: true },
	plugins: [viteReact({ compiler: true })],
	test: {
		browser: {
			enabled: true,
			headless: true,
			instances: [{ browser: 'chromium' }],
			provider: playwright({
				launchOptions: {
					executablePath:
						process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
						(existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
				},
			}),
		},
	},
	run: {
		tasks: {
			'vp:tsc': 'tsc --noEmit',
		},
	},
})

export default config
