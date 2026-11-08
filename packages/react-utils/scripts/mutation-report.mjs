import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATUSES = [
	'Killed',
	'Timeout',
	'Survived',
	'NoCoverage',
	'CompileError',
	'RuntimeError',
	'Ignored',
	'Pending',
]
const SURVIVORS = new Set(['Survived', 'NoCoverage'])

// Stryker columns are 1-based, with an exclusive end.
const sourceAt = (source, location) => {
	const line = source.split('\n')[location.start.line - 1] ?? ''
	return location.start.line === location.end.line
		? line.slice(location.start.column - 1, location.end.column - 1)
		: line.slice(location.start.column - 1)
}

const code = (text) =>
	`\`${text.replaceAll('`', '\\`').replaceAll('|', '\\|')}\``

export const renderReport = (report) => {
	const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]))
	const survivors = []
	for (const [path, file] of Object.entries(report.files)) {
		for (const mutant of file.mutants) {
			counts[mutant.status] = (counts[mutant.status] ?? 0) + 1
			if (SURVIVORS.has(mutant.status)) {
				const { start } = mutant.location
				survivors.push({
					path,
					line: start.line,
					column: start.column,
					mutator: mutant.mutatorName,
					replacement: mutant.replacement,
					status: mutant.status,
					original: sourceAt(file.source, mutant.location),
				})
			}
		}
	}
	survivors.sort(
		(a, b) =>
			a.path.localeCompare(b.path) ||
			a.line - b.line ||
			a.column - b.column ||
			a.mutator.localeCompare(b.mutator) ||
			a.replacement.localeCompare(b.replacement),
	)

	const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
	return [
		'| Status | Count |',
		'| --- | ---: |',
		...STATUSES.filter((status) => counts[status] > 0).map(
			(status) => `| ${status} | ${counts[status]} |`,
		),
		`| **Total** | **${total}** |`,
		'',
		`Surviving or uncovered mutants: ${survivors.length}`,
		'',
		'| Status | Location | Mutator | Original | Replacement |',
		'| --- | --- | --- | --- | --- |',
		...survivors.map(
			(s) =>
				`| ${s.status} | \`${s.path}:${s.line}:${s.column}\` | ${s.mutator} | ${code(s.original)} | ${code(s.replacement)} |`,
		),
		'',
	].join('\n')
}

const isMain =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
	const args = process.argv.slice(2)
	const option = (name) => {
		const index = args.indexOf(name)
		return index === -1 ? undefined : args[index + 1]
	}
	const reportArg = args.find(
		(arg, index) =>
			!arg.startsWith('--') && !['--out', '--check'].includes(args[index - 1]),
	)
	const reportPath = resolve(reportArg ?? 'reports/mutation/mutation.json')
	const outPath = option('--out')
	const checkPath = option('--check')
	const markdown = renderReport(JSON.parse(readFileSync(reportPath, 'utf8')))

	if (checkPath) {
		if (!readFileSync(resolve(checkPath), 'utf8').includes(markdown)) {
			console.error(
				`${checkPath} does not contain the generated mutation report for ${reportPath}`,
			)
			process.exit(1)
		}
		console.log(`${checkPath} matches ${reportPath}`)
	} else if (outPath) {
		writeFileSync(resolve(outPath), markdown)
		console.log(`wrote ${outPath}`)
	} else {
		process.stdout.write(markdown)
	}
}
