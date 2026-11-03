/**
 * Stryker 10's sandbox preprocessor calls `ts.parseConfigFileTextToJson`,
 * which TypeScript 7 does not export, so `tsconfigFile` points at a missing
 * file to skip the rewrite and `@stryker-mutator/typescript-checker` is not
 * used. The sandbox is created two levels below the repo root so the
 * unrewritten `extends: ../../tsconfig.base.json` still resolves.
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
	plugins: ['@stryker-mutator/vitest-runner'],
	tsconfigFile: 'stryker-no-tsconfig.json',
	testRunner: 'vitest',
	vitest: { configFile: 'stryker.vitest.config.ts' },
	mutate: [
		'src/store/store/**/*.ts',
		'!src/store/store/**/*.testing.ts',
		'!src/store/store/**/*.test.ts',
		'!src/store/store/**/*.test-d.ts',
		'!src/store/store/**/*.bench.ts',
	],
	coverageAnalysis: 'perTest',
	concurrency: 4,
	timeoutMS: 10000,
	timeoutFactor: 2,
	incremental: true,
	incrementalFile: 'reports/stryker-incremental.json',
	reporters: ['clear-text', 'progress', 'html', 'json'],
	htmlReporter: { fileName: 'reports/mutation/index.html' },
	jsonReporter: { fileName: 'reports/mutation/mutation.json' },
	tempDirName: '../../.stryker-tmp',
	cleanTempDir: true,
}
