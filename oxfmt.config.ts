import type { OxfmtConfig } from 'vite-plus/fmt'

const fmtConfig: OxfmtConfig = {
	arrowParens: 'always',
	ignorePatterns: ['.*', '**/*.gen.*'],
	jsxSingleQuote: true,
	printWidth: 80,
	semi: false,
	singleQuote: true,
	sortImports: true,
	sortPackageJson: true,
	trailingComma: 'all',
	useTabs: true,
}

export default fmtConfig
