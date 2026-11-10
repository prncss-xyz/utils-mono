import { describe, expect, it } from 'vitest'

import {
	derivedAtom,
	primitiveAtom,
	type AtomSymbol,
	type Read,
	type Store,
} from '.'
import { countOperations, countsByName, createStore } from './utils.testing'

const flushMicrotask = () => Promise.resolve()

const signal = <T>(name: string, value: T) => primitiveAtom(value, { name })

const computed = <T>(name: string, getter: (read: Read) => T) =>
	derivedAtom(getter, null, { name })

type Graph = {
	sinks: AtomSymbol<any, never>[]
	warmup?: (store: Store) => void
	update: (store: Store) => void
}

type Runs = Record<string, number>

type Case = {
	title: string
	graph: () => Graph
	values: unknown[]
	peeked: Runs
	subscribed: { getters: Runs; notifications: number }
}

const once = (...names: string[]): Runs =>
	Object.fromEntries(names.map((name) => [name, 1]))

/**
 * Cases adapted from the reactive-framework-test-suite used by Alien Signals'
 * conformance spec. Each write batch commits at the next microtask, so a
 * synchronous write followed by a read becomes a write, a flush, then a read.
 * `peeked` counts getter runs when the sinks are only read, `subscribed` when
 * each sink has one subscription.
 */
const cases: Case[] = [
	{
		title: '#1 diamond',
		graph: () => {
			const a = signal('a', 'a')
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(a))
			const d = computed('d', (read) => `${read(b)} ${read(c)}`)
			return { sinks: [d], update: (store) => store.send(a, 'aa') }
		},
		values: ['aa aa'],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#2 diamond + tail',
		graph: () => {
			const a = signal('a', 'a')
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(a))
			const d = computed('d', (read) => `${read(b)} ${read(c)}`)
			const e = computed('e', (read) => read(d))
			return { sinks: [e], update: (store) => store.send(a, 'aa') }
		},
		values: ['aa aa'],
		peeked: once('b', 'c', 'd', 'e'),
		subscribed: { getters: once('b', 'c', 'd', 'e'), notifications: 1 },
	},
	{
		title: '#3 jagged diamond + tails',
		graph: () => {
			const a = signal('a', 'a')
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(a))
			const d = computed('d', (read) => read(c))
			const e = computed('e', (read) => `${read(b)} ${read(d)}`)
			const f = computed('f', (read) => read(e))
			const g = computed('g', (read) => read(e))
			return { sinks: [e, f, g], update: (store) => store.send(a, 'b') }
		},
		values: ['b b', 'b b', 'b b'],
		peeked: once('b', 'c', 'd', 'e', 'f', 'g'),
		subscribed: {
			getters: once('b', 'c', 'd', 'e', 'f', 'g'),
			notifications: 3,
		},
	},
	{
		title: '#5 drop A→B→A updates',
		graph: () => {
			const a = signal('a', 2)
			const b = computed('b', (read) => read(a) - 1)
			const c = computed('c', (read) => read(a) + read(b))
			const d = computed('d', (read) => `d: ${read(c)}`)
			return { sinks: [d], update: (store) => store.send(a, 4) }
		},
		values: ['d: 7'],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#6 one unchanged dep does not block update from changed dep',
		graph: () => {
			const a = signal('a', 'a')
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => {
				read(a)
				return 'c'
			})
			const d = computed('d', (read) => `${read(b)} ${read(c)}`)
			return { sinks: [d], update: (store) => store.send(a, 'aa') }
		},
		values: ['aa c'],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#7 unchanged computed values stop propagation to downstream',
		graph: () => {
			const a = signal('a', 'a')
			const b = computed('b', (read) => {
				read(a)
				return 'b'
			})
			const c = computed('c', (read) => {
				read(a)
				return 'c'
			})
			const d = computed('d', (read) => `${read(b)} ${read(c)}`)
			return { sinks: [d], update: (store) => store.send(a, 'aa') }
		},
		values: ['b c'],
		peeked: once('b', 'c'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#9 linear convergence',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(a) + read(b))
			const d = computed('d', (read) => read(a) + read(c))
			return { sinks: [d], update: (store) => store.send(a, 1) }
		},
		values: [3],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#10 exponential convergence',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(b) + read(a))
			const d = computed('d', (read) => read(c) + read(b))
			const e = computed('e', (read) => read(d) + read(c))
			return { sinks: [e], update: (store) => store.send(a, 1) }
		},
		values: [5],
		peeked: once('b', 'c', 'd', 'e'),
		subscribed: { getters: once('b', 'c', 'd', 'e'), notifications: 1 },
	},
	{
		title: '#157 three-way diamond: sub updates when two of three deps unmark',
		graph: () => {
			const a = signal('a', 'a')
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => {
				read(a)
				return 'c'
			})
			const d = computed('d', (read) => {
				read(a)
				return 'd'
			})
			const e = computed('e', (read) => `${read(b)} ${read(c)} ${read(d)}`)
			return { sinks: [e], update: (store) => store.send(a, 'aa') }
		},
		values: ['aa c d'],
		peeked: once('b', 'c', 'd', 'e'),
		subscribed: { getters: once('b', 'c', 'd', 'e'), notifications: 1 },
	},
	{
		title: '#188 batch + dynamic deps: unnecessary recompute avoided',
		graph: () => {
			const a = signal('a', 0)
			const b = signal('b', 0)
			const c = computed('c', (read) => read(b))
			const d = computed('d', (read) => (read(a) === 0 ? read(c) : -1))
			return {
				sinks: [d],
				update: (store) => {
					store.send(b, 1)
					store.send(a, 1)
				},
			}
		},
		values: [-1],
		peeked: once('d'),
		subscribed: { getters: once('d'), notifications: 1 },
	},
	{
		title: '#189 multi-signal change: topological ordering preserved',
		graph: () => {
			const a = signal('a', 1)
			const b = signal('b', 1)
			const c = signal('c', 1)
			const d = computed('d', (read) => read(c))
			const e = computed('e', (read) =>
				read(a) > 0 ? read(b) + read(d) : read(b),
			)
			return {
				sinks: [e],
				update: (store) => {
					store.send(a, 2)
					store.send(b, 2)
					store.send(c, 2)
				},
			}
		},
		values: [4],
		peeked: once('d', 'e'),
		subscribed: { getters: once('d', 'e'), notifications: 1 },
	},
	{
		title: '#189 multi-signal change: unreachable computed skipped',
		graph: () => {
			const a = signal('a', 1)
			const b = signal('b', 1)
			const c = signal('c', 1)
			const d = computed('d', (read) => read(c))
			const e = computed('e', (read) =>
				read(a) > 0 ? read(b) + read(d) : read(b),
			)
			const write = (store: Store, value: number) => {
				store.send(a, value)
				store.send(b, value)
				store.send(c, value)
			}
			return {
				sinks: [e],
				warmup: (store) => write(store, 2),
				update: (store) => write(store, -1),
			}
		},
		values: [-1],
		peeked: once('e'),
		subscribed: { getters: once('e'), notifications: 1 },
	},
	{
		title: '#192 effect not re-run when computed dep value unchanged',
		graph: () => {
			const s = signal('s', 0)
			const c = computed('c', (read) => {
				read(s)
				return 0
			})
			return { sinks: [c], update: (store) => store.send(s, 1) }
		},
		values: [0],
		peeked: once('c'),
		subscribed: { getters: once('c'), notifications: 1 },
	},
	{
		title: '#204 multi-source fan-in',
		graph: () => {
			const a = signal('a', 1)
			const b = signal('b', 10)
			const c = computed('c', (read) => read(a) + read(b))
			return {
				sinks: [c],
				update: (store) => {
					store.send(a, 2)
					store.send(b, 20)
				},
			}
		},
		values: [22],
		peeked: once('c'),
		subscribed: { getters: once('c'), notifications: 1 },
	},
	{
		title: '#205 multi-source cross-diamond',
		graph: () => {
			const a = signal('a', 1)
			const b = signal('b', 10)
			const c = computed('c', (read) => read(a) + read(b))
			const d = computed('d', (read) => read(a) * read(b))
			const e = computed('e', (read) => read(c) + read(d))
			return {
				sinks: [e],
				update: (store) => {
					store.send(a, 2)
					store.send(b, 20)
				},
			}
		},
		values: [62],
		peeked: once('c', 'd', 'e'),
		subscribed: { getters: once('c', 'd', 'e'), notifications: 1 },
	},
	{
		title: '#206 stacked diamonds',
		graph: () => {
			const a = signal('a', 1)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(a))
			const d = computed('d', (read) => read(b) + read(c))
			const e = computed('e', (read) => read(d))
			const f = computed('f', (read) => read(d))
			const g = computed('g', (read) => read(e) + read(f))
			return { sinks: [g], update: (store) => store.send(a, 2) }
		},
		values: [8],
		peeked: once('b', 'c', 'd', 'e', 'f', 'g'),
		subscribed: {
			getters: once('b', 'c', 'd', 'e', 'f', 'g'),
			notifications: 1,
		},
	},
	{
		title: '#207 wide fan-out: all effects fire once',
		graph: () => {
			const a = signal('a', 0)
			const sinks = Array.from({ length: 6 }, (_, index) =>
				computed(`c${index}`, (read) => read(a) + index),
			)
			return { sinks, update: (store) => store.send(a, 1) }
		},
		values: [1, 2, 3, 4, 5, 6],
		peeked: once('c0', 'c1', 'c2', 'c3', 'c4', 'c5'),
		subscribed: {
			getters: once('c0', 'c1', 'c2', 'c3', 'c4', 'c5'),
			notifications: 6,
		},
	},
	{
		title: '#208 deep asymmetric join (depth 3 vs 1)',
		graph: () => {
			const a = signal('a', 1)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(b))
			const d = computed('d', (read) => read(c))
			const e = computed('e', (read) => read(a))
			const f = computed('f', (read) => read(d) + read(e))
			return { sinks: [f], update: (store) => store.send(a, 2) }
		},
		values: [4],
		peeked: once('b', 'c', 'd', 'e', 'f'),
		subscribed: { getters: once('b', 'c', 'd', 'e', 'f'), notifications: 1 },
	},
	{
		title: '#28 same primitive value — no propagation',
		graph: () => {
			const a = signal('a', 1)
			const c = computed('c', (read) => read(a))
			return { sinks: [c], update: (store) => store.send(a, 1) }
		},
		values: [1],
		peeked: {},
		subscribed: { getters: {}, notifications: 0 },
	},
	{
		title: '#34 pruning stops at first unchanged node',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => (read(a) > 0 ? 1 : 0))
			const c = computed('c', (read) => read(b))
			const d = computed('d', (read) => read(c))
			return {
				sinks: [d],
				warmup: (store) => store.send(a, 1),
				update: (store) => store.send(a, 2),
			}
		},
		values: [1],
		peeked: once('b'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title:
			'#169 live pruning: effect not re-run when intermediate computed returns same',
		graph: () => {
			const s = signal('s', 0)
			const c1 = computed('c1', (read) => read(s))
			const c2 = computed('c2', (read) => {
				read(c1)
				return 5
			})
			return { sinks: [c2], update: (store) => store.send(s, 1) }
		},
		values: [5],
		peeked: once('c1', 'c2'),
		subscribed: { getters: once('c1', 'c2'), notifications: 1 },
	},
	{
		title: '#220 computed same object reference — no downstream propagation',
		graph: () => {
			const object = { x: 1 }
			const a = signal('a', 0)
			const b = computed('b', (read) => {
				read(a)
				return object
			})
			const c = computed('c', (read) => read(b))
			return { sinks: [c], update: (store) => store.send(a, 1) }
		},
		values: [{ x: 1 }],
		peeked: once('b'),
		subscribed: { getters: once('b', 'c'), notifications: 1 },
	},
	{
		title: '#18 cached — not re-evaluated if deps unchanged',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a))
			return { sinks: [b], update: () => {} }
		},
		values: [0],
		peeked: {},
		subscribed: { getters: {}, notifications: 0 },
	},
	{
		title: '#22 chained computed avoids redundant re-compute',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(b))
			const d = computed('d', (read) => read(c))
			return { sinks: [d], update: (store) => store.send(a, 1) }
		},
		values: [1],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#25 no re-compute if zero dependencies',
		graph: () => {
			const a = computed('a', () => 42)
			return { sinks: [a], update: () => {} }
		},
		values: [42],
		peeked: {},
		subscribed: { getters: {}, notifications: 0 },
	},
	{
		title: '#145 undefined is a valid computed value (not uninitialized)',
		graph: () => {
			const a = signal('a', 0)
			const c = computed('c', (read) => (read(a) === 0 ? undefined : read(a)))
			return {
				sinks: [c],
				warmup: (store) => store.send(a, 1),
				update: (store) => store.send(a, 0),
			}
		},
		values: [undefined],
		peeked: once('c'),
		subscribed: { getters: once('c'), notifications: 1 },
	},
	{
		title: '#147 computed not recomputed in batch if dep reverts',
		graph: () => {
			const a = signal('a', 0)
			const c = computed('c', (read) => read(a))
			return {
				sinks: [c],
				update: (store) => {
					store.send(a, 5)
					store.send(a, 0)
				},
			}
		},
		values: [0],
		peeked: {},
		subscribed: { getters: {}, notifications: 0 },
	},
	{
		title: '#94 stale invocation does not trigger pending computations',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => {
				read(a)
				return 'c'
			})
			const d = computed('d', (read) => `${read(b)} ${read(c)}`)
			return { sinks: [d], update: (store) => store.send(a, 1) }
		},
		values: ['1 c'],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#97 flags indirectly updated during dirty-checking',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(b))
			const d = computed('d', (read) => read(a) + read(c))
			return { sinks: [d], update: (store) => store.send(a, 1) }
		},
		values: [2],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 1 },
	},
	{
		title: '#158 stale chained computed accessed after update: values fresh',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a) + 1)
			const c = computed('c', (read) => read(b) + 1)
			const d = computed('d', (read) => read(c) + 1)
			return { sinks: [b, c, d], update: (store) => store.send(a, 10) }
		},
		values: [11, 12, 13],
		peeked: once('b', 'c', 'd'),
		subscribed: { getters: once('b', 'c', 'd'), notifications: 3 },
	},
	{
		title: '#12 inactive dep does not trigger',
		graph: () => {
			const a = signal('a', 'a')
			const b = signal('b', 'b')
			const cond = signal('cond', true)
			const c = computed('c', (read) => (read(cond) ? read(a) : read(b)))
			return { sinks: [c], update: (store) => store.send(b, 'bb') }
		},
		values: ['a'],
		peeked: {},
		subscribed: { getters: {}, notifications: 0 },
	},
	{
		title: '#12 active dep triggers',
		graph: () => {
			const a = signal('a', 'a')
			const b = signal('b', 'b')
			const cond = signal('cond', true)
			const c = computed('c', (read) => (read(cond) ? read(a) : read(b)))
			return { sinks: [c], update: (store) => store.send(a, 'aa') }
		},
		values: ['aa'],
		peeked: once('c'),
		subscribed: { getters: once('c'), notifications: 1 },
	},
	{
		title: '#13 switching branches deactivates old deps',
		graph: () => {
			const a = signal('a', 'a')
			const b = signal('b', 'b')
			const cond = signal('cond', true)
			const c = computed('c', (read) => (read(cond) ? read(a) : read(b)))
			return {
				sinks: [c],
				warmup: (store) => store.send(cond, false),
				update: (store) => store.send(a, 'aa'),
			}
		},
		values: ['b'],
		peeked: {},
		subscribed: { getters: {}, notifications: 0 },
	},
	{
		title: '#13 switching branches activates new deps',
		graph: () => {
			const a = signal('a', 'a')
			const b = signal('b', 'b')
			const cond = signal('cond', true)
			const c = computed('c', (read) => (read(cond) ? read(a) : read(b)))
			return {
				sinks: [c],
				warmup: (store) => store.send(cond, false),
				update: (store) => store.send(b, 'bb'),
			}
		},
		values: ['bb'],
		peeked: once('c'),
		subscribed: { getters: once('c'), notifications: 1 },
	},
	{
		title: '#14 new deps updated before dependee',
		graph: () => {
			const a = signal('a', 1)
			const b = signal('b', 10)
			const cond = signal('cond', false)
			const c = computed('c', (read) => read(a))
			const d = computed('d', (read) => (read(cond) ? read(c) : read(b)))
			return {
				sinks: [d],
				update: (store) => {
					store.send(cond, true)
					store.send(a, 2)
				},
			}
		},
		values: [2],
		peeked: once('c', 'd'),
		subscribed: { getters: once('c', 'd'), notifications: 1 },
	},
	{
		title: '#16 lazy branch',
		graph: () => {
			const a = signal('a', 0)
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => (read(a) > 0 ? read(a) : read(b)))
			return {
				sinks: [c],
				warmup: (store) => store.send(a, 1),
				update: (store) => store.send(a, 0),
			}
		},
		values: [0],
		peeked: once('b', 'c'),
		subscribed: { getters: once('b', 'c'), notifications: 1 },
	},
	{
		title:
			'#193 sequential dirty check: branch switch skips unreachable computed',
		graph: () => {
			const a = signal<{ v: number } | null>('a', { v: 1 })
			const b = computed('b', (read) => read(a))
			const c = computed('c', (read) => read(b)?.v)
			const d = computed('d', (read) => (read(b) ? read(c) : 0))
			return { sinks: [d], update: (store) => store.send(a, null) }
		},
		values: [0],
		peeked: once('b', 'd'),
		subscribed: { getters: once('b', 'd'), notifications: 1 },
	},
	{
		title:
			'#196 maybe-dirty diamond: first dep unmarked, second still triggers',
		graph: () => {
			const src1 = signal('src1', 0)
			const src2 = signal('src2', 0)
			const c1 = computed('c1', (read) => read(src1))
			const c2 = computed('c2', (read) => (read(src1) % 2) + read(src2))
			const c3 = computed('c3', (read) => read(c1) + read(c2))
			return { sinks: [c3], update: (store) => store.send(src1, 2) }
		},
		values: [2],
		peeked: once('c1', 'c2', 'c3'),
		subscribed: { getters: once('c1', 'c2', 'c3'), notifications: 1 },
	},
	{
		title:
			'#197 chained value-equality stops propagation across multiple writes',
		graph: () => {
			const src = signal('src', 0)
			const c1 = computed('c1', (read) => read(src) % 2)
			const c2 = computed('c2', (read) => read(c1) + 1)
			return {
				sinks: [c2],
				update: (store) => {
					store.send(src, 2)
					store.send(src, 4)
					store.send(src, 6)
				},
			}
		},
		values: [1],
		peeked: once('c1'),
		subscribed: { getters: once('c1', 'c2'), notifications: 1 },
	},
]

describe('Alien Signals conformance', () => {
	it.each(cases)('$title (peeked)', async ({ graph, values, peeked }) => {
		const { sinks, warmup, update } = graph()
		const store = createStore()
		for (const sink of sinks) store.peek(sink)
		warmup?.(store)
		await flushMicrotask()
		for (const sink of sinks) store.peek(sink)
		const instrumentation = countOperations(store)
		update(store)
		await flushMicrotask()
		expect(sinks.map((sink) => store.peek(sink))).toEqual(values)
		expect(countsByName(instrumentation, 'getters')).toEqual(peeked)
	})

	it.each(cases)(
		'$title (subscribed)',
		async ({ graph, values, subscribed }) => {
			const { sinks, warmup, update } = graph()
			const store = createStore()
			for (const sink of sinks) store.subscribe(sink, () => {})
			await flushMicrotask()
			warmup?.(store)
			await flushMicrotask()
			const instrumentation = countOperations(store)
			update(store)
			await flushMicrotask()
			expect(sinks.map((sink) => store.peek(sink))).toEqual(values)
			expect({
				getters: countsByName(instrumentation, 'getters'),
				notifications: instrumentation.totals.notifications,
			}).toEqual(subscribed)
		},
	)
})
