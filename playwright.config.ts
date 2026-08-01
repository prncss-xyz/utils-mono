import { execSync } from 'node:child_process'

import { defineConfig, devices } from '@playwright/test'

// Playwright runs in Node, not Vite, so it reads VITE_BASE_PATH from
// process.env (set by the workflow) and reuses the same formula as
// src/meta.ts via buildBasePath. Tests poll and navigate relative to
// this prefix so e2e runs against the same basePath-baked build that
// ships to GitHub Pages.
const chromiumPath = (() => {
	try {
		return execSync('which chromium', { encoding: 'utf8' }).trim()
	} catch {
		return undefined
	}
})()

export default defineConfig({
	testDir: './spec',
	testMatch: '**/*.spec.tsx',
	snapshotDir: './__snapshots__',
	outputDir: 'test-results',
	timeout: 10 * 1000,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [
		['html'],
		['json', { outputFile: 'playwright-report/results.json' }],
	],
	use: {
		headless: true,
		trace: 'on-first-retry',
	},
	webServer: {
		command: './node_modules/.bin/waku start',
		timeout: 120 * 1000,
		reuseExistingServer: !process.env.CI,
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Use a system browser when available; otherwise fall back to Playwright's bundled one.
				...(chromiumPath && {
					launchOptions: { executablePath: chromiumPath },
				}),
			},
		},
	],
})
