import { expect, it } from 'vitest'

import { renderReport } from './mutation-report.mjs'

const report = {
	files: {
		'src/a.ts': {
			source: 'const x = a > 0\nconst y = false',
			mutants: [
				{
					id: '1',
					mutatorName: 'EqualityOperator',
					replacement: 'a >= 0',
					status: 'Survived',
					location: {
						start: { line: 1, column: 11 },
						end: { line: 1, column: 16 },
					},
				},
				{
					id: '2',
					mutatorName: 'BooleanLiteral',
					replacement: 'true',
					status: 'Killed',
					location: {
						start: { line: 2, column: 11 },
						end: { line: 2, column: 16 },
					},
				},
				{
					id: '3',
					mutatorName: 'BooleanLiteral',
					replacement: 'false',
					status: 'NoCoverage',
					location: {
						start: { line: 2, column: 11 },
						end: { line: 2, column: 16 },
					},
				},
			],
		},
	},
}

it('counts every status and lists only surviving or uncovered mutants', () => {
	const markdown: string = renderReport(report)
	expect(markdown).toContain('| Killed | 1 |')
	expect(markdown).toContain('| NoCoverage | 1 |')
	expect(markdown).toContain('| **Total** | **3** |')
	expect(markdown).toContain('Surviving or uncovered mutants: 2')
	expect(markdown).not.toContain('| Killed | `src')
})

it('quotes the original source using Stryker 1-based columns with an exclusive end', () => {
	const markdown: string = renderReport(report)
	expect(markdown).toContain(
		'| Survived | `src/a.ts:1:11` | EqualityOperator | `a > 0` | `a >= 0` |',
	)
	expect(markdown).toContain(
		'| NoCoverage | `src/a.ts:2:11` | BooleanLiteral | `false` | `false` |',
	)
})
