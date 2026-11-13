import { getHeapStatistics } from 'node:v8'

import { test } from 'vite-plus/test'

import { atomFamily, derivedAtom, primitiveAtom } from '.'
import { chain, createStore, flushMicrotask } from './utils.testing'

/**
 * Allocation benchmark: bytes allocated per iteration for each workload, to
 * justify or reject changes to the graph storage layout.
 *
 * Run from the repository root:
 *
 *     vp test bench --run --project='unit (bench)' --silent=false packages/react-utils/src/store/store/allocation.bench.ts
 *
 * `--silent=false` is required to see the output. Each workload prints one row:
 * median, min and max over `runs` runs of `iterations` iterations, after
 * `warmup` untimed iterations.
 *
 * The numbers are V8 `total_allocated_bytes` deltas, that is bytes allocated
 * rather than bytes retained. An empty iteration (one `await flushMicrotask()`)
 * is measured the same way and subtracted from every row. Compare medians only
 * between runs on the same machine and Node version. Observed run-to-run
 * tolerance of the median across separate invocations was within 5% for every
 * row over four invocations (family churn widest, mounted rows within 1.5%);
 * single runs (min and max) spread much wider, so do not read differences
 * smaller than the tolerance as changes.
 */

/**
 * Throws when `actual` differs from `expected`. It stands in for `expect`,
 * which allocates and would inflate the bytes measured per iteration.
 */
function verify(actual: number, expected: number) {
	if (actual !== expected)
		throw new Error(`expected ${expected}, received ${actual}`)
}

const warmup = 2_000
const iterations = 2_000
const runs = 15

type Iteration = (index: number) => Promise<void>

type Workload = {
	name: string
	setup: () => Iteration
}

function readWorkloads({ mounted }: { mounted: boolean }): Workload[] {
	const suffix = mounted ? ' (mounted)' : ''
	return [
		{
			name: `stable reads${suffix}`,
			setup: () => {
				const store = createStore()
				const root = primitiveAtom(0)
				const tip = chain(root, 10)
				if (mounted) store.subscribe(tip, () => {})
				return async (index) => {
					store.send(root, index + 1)
					await flushMicrotask()
					verify(store.peek(tip), index + 11)
				}
			},
		},
		{
			name: `repeated reads${suffix}`,
			setup: () => {
				const store = createStore()
				const root = primitiveAtom(0)
				const repeated = derivedAtom((read) => {
					let sum = 0
					for (let count = 0; count < 10; count++) sum += read(root)
					return sum
				})
				if (mounted) store.subscribe(repeated, () => {})
				return async (index) => {
					store.send(root, index + 1)
					await flushMicrotask()
					verify(store.peek(repeated), (index + 1) * 10)
				}
			},
		},
		{
			name: `reordered reads${suffix}`,
			setup: () => {
				const store = createStore()
				const roots = Array.from({ length: 8 }, (_, index) =>
					primitiveAtom(index),
				)
				const flag = primitiveAtom(false)
				const reordered = derivedAtom((read) => {
					const ordered = read(flag) ? roots.slice().reverse() : roots
					return ordered.reduce((sum, root) => sum + read(root), 0)
				})
				if (mounted) store.subscribe(reordered, () => {})
				return async (index) => {
					store.send(flag, index % 2 === 1)
					await flushMicrotask()
					verify(store.peek(reordered), 28)
				}
			},
		},
	]
}

const workloads: Workload[] = [
	...readWorkloads({ mounted: false }),
	...readWorkloads({ mounted: true }),
	{
		name: 'branch churn',
		setup: () => {
			const store = createStore()
			const flag = primitiveAtom(false)
			const roots = [primitiveAtom(10), primitiveAtom(20)]
			const branches = roots.map((root) =>
				derivedAtom((read) => read(root) * 2),
			)
			const conditional = derivedAtom((read) =>
				read(branches[read(flag) ? 1 : 0]!),
			)
			store.subscribe(conditional, () => {})
			return async (index) => {
				store.send(flag, index % 2 === 1)
				await flushMicrotask()
				verify(store.peek(conditional), index % 2 === 1 ? 40 : 20)
			}
		},
	},
	{
		name: 'mount/release',
		setup: () => {
			const store = createStore()
			const root = primitiveAtom(0)
			const tip = chain(root, 10)
			return async () => {
				const unsubscribe = store.subscribe(tip, () => {})
				await flushMicrotask()
				unsubscribe()
			}
		},
	},
	{
		name: 'family churn',
		setup: () => {
			const store = createStore()
			const family = atomFamily((key: number) => derivedAtom(() => key), {
				TTL: 0,
			})
			return async (index) => {
				verify(store.resolve(family, index).peek(), index)
				await flushMicrotask()
			}
		},
	},
	{
		name: 'many-store creation',
		setup: () => {
			const root = primitiveAtom(0)
			const tip = chain(root, 3)
			return async () => {
				const store = createStore()
				await flushMicrotask()
				verify(store.peek(tip), 3)
			}
		},
	},
]

async function measure(iteration: Iteration, count: number, offset: number) {
	const before = getHeapStatistics().total_allocated_bytes
	for (let index = 0; index < count; index++) await iteration(offset + index)
	return getHeapStatistics().total_allocated_bytes - before
}

async function bytesPerIteration(iteration: Iteration) {
	let offset = 0
	await measure(iteration, warmup, offset)
	offset += warmup
	const samples: number[] = []
	for (let run = 0; run < runs; run++) {
		samples.push((await measure(iteration, iterations, offset)) / iterations)
		offset += iterations
	}
	samples.sort((a, b) => a - b)
	return {
		median: samples[Math.floor(samples.length / 2)]!,
		min: samples[0]!,
		max: samples[samples.length - 1]!,
	}
}

let baseline: ReturnType<typeof bytesPerIteration> | undefined

const nameWidth = Math.max(...workloads.map(({ name }) => name.length))

for (const { name, setup } of workloads) {
	test(name, { timeout: 120_000 }, async () => {
		baseline ??= bytesPerIteration(async () => {
			await flushMicrotask()
		})
		const empty = await baseline
		const result = await bytesPerIteration(setup())
		const bytes = (value: number, base: number) => Math.round(value - base)
		console.log(
			`${name.padEnd(nameWidth)} median ${bytes(result.median, empty.median)}  min ${bytes(result.min, empty.median)}  max ${bytes(result.max, empty.median)}  (empty iteration ${Math.round(empty.median)})`,
		)
	})
}
