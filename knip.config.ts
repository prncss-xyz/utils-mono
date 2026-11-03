import type { KnipConfig } from 'knip'

export default {
	workspaces: {
		'.': {
			entry: ['oxfmt.config.ts!'],
		},
		'apps/web': {
			entry: ['index.html!'],
			project: ['src/**/*.{ts,tsx,css}!'],
		},
		'packages/react-utils': {
			entry: [
				'src/index.ts!',
				'stryker.vitest.config.ts!',
				'stryker.setup.testing.ts!',
			],
			project: [
				'**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx,mdx,css}!',
				'!**/*.testing.ts!',
			],
		},
	},
	compilers: {
		css: (text: string) => [...text.matchAll(/(?<=@)import[^;]+/g)].join('\n'),
	},
	ignoreBinaries: ['typos'],
	ignoreDependencies: ['@commitlint/cli', 'bumpp'],
} satisfies KnipConfig
