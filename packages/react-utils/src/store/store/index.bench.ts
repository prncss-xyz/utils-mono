import { expect, test } from 'vite-plus/test'

import {
	atomFamily,
	derivedAtom,
	effectAtom,
	primitiveAtom,
	type Store,
} from '.'
import {
	chain,
	countOperations,
	createOperationCounts,
	createStore,
	flushMicrotask,
	layeredGraph,
	stopCountingOperations,
	type OperationCounts,
} from './utils.testing'

type Counters = {
	getters: number
	subscribers: number
	effects: number
	mounts: number
	cleanups: number
}

type Scenario = {
	stores: Store[]
	update: () => void
	read: () => number
	verify: (value: number) => void
	dispose: () => void
	/** Operations of one iteration, summed over `stores`. */
	operations: Partial<OperationCounts>
}

function sumOperations(counts: OperationCounts[]): OperationCounts {
	const sum = createOperationCounts()
	for (const count of counts)
		for (const operation of Object.keys(sum) as (keyof OperationCounts)[])
			sum[operation] += count[operation]
	return sum
}

function scenario(name: string, setup: (counts: Counters) => Scenario) {
	test(name, { timeout: 30_000 }, async ({ bench }) => {
		const counts: Counters = {
			getters: 0,
			subscribers: 0,
			effects: 0,
			mounts: 0,
			cleanups: 0,
		}
		const graph = setup(counts)
		let value = 0
		const iterate = async () => {
			graph.update()
			await flushMicrotask()
			value = graph.read()
			await flushMicrotask()
		}
		try {
			await flushMicrotask()
			await flushMicrotask()
			await iterate()
			const operations = graph.stores.map(
				(store) => countOperations(store).totals,
			)
			await iterate()
			graph.verify(value)
			expect(sumOperations(operations)).toEqual({
				...createOperationCounts(),
				...graph.operations,
			})
			for (const store of graph.stores) stopCountingOperations(store)
			const settled = { ...counts }
			await flushMicrotask()
			await flushMicrotask()
			expect(counts).toEqual(settled)
			await bench(name, iterate).run()
			graph.verify(value)
		} finally {
			graph.dispose()
			await flushMicrotask()
		}
	})
}

for (const resolved of [false, true]) {
	scenario(`cached reads: ${resolved ? 'resolve' : 'direct'}`, (counts) => {
		const store = createStore()
		const root = primitiveAtom(1)
		const cached = derivedAtom((read) => {
			counts.getters++
			return read(root) + 1
		})
		const handle = store.resolve(cached)
		store.peek(cached)
		return {
			stores: [store],
			update: () => {},
			read: () => (resolved ? handle.peek() : store.peek(cached)),
			verify: (value) => {
				expect(value).toBe(2)
				expect(counts.getters).toBe(1)
			},
			dispose: () => {},
			operations: {},
		}
	})
}

function deepChain(storeCount: number): Scenario {
	const root = primitiveAtom(0)
	const tip = chain(root, 1_000)
	const stores = Array.from({ length: storeCount }, () => createStore())
	for (const store of stores) store.peek(tip)
	let next = 0
	return {
		stores,
		update: () => {
			next++
			for (const store of stores) store.send(root, next)
		},
		read: () => stores.reduce((sum, store) => sum + store.peek(tip), 0),
		verify: (value) => expect(value).toBe((next + 1_000) * storeCount),
		dispose: () => {},
		operations: {
			getters: 1_000 * storeCount,
			invalidations: storeCount,
			validations: 1_000 * storeCount,
		},
	}
}

function diamond(counts: Counters, storeCount: number): Scenario {
	const root = primitiveAtom(0)
	const middles = Array.from({ length: 1_000 }, (_, index) =>
		derivedAtom((read) => {
			counts.getters++
			return read(root) + index
		}),
	)
	const sink = derivedAtom((read) => {
		counts.getters++
		return middles.reduce((sum, middle) => sum + read(middle), 0)
	})
	const stores = Array.from({ length: storeCount }, () => createStore())
	const disposers = stores.map((store) =>
		store.subscribe(sink, () => {
			counts.subscribers++
		}),
	)
	let next = 0
	return {
		stores,
		update: () => {
			next++
			for (const store of stores) store.send(root, next)
		},
		read: () => stores.reduce((sum, store) => sum + store.peek(sink), 0),
		verify: (value) =>
			expect(value).toBe((next * 1_000 + 499_500) * storeCount),
		dispose: () => {
			for (const dispose of disposers) dispose()
		},
		operations: {
			getters: 1_001 * storeCount,
			invalidations: 1_002 * storeCount,
			validations: storeCount,
			notifications: storeCount,
		},
	}
}

scenario('deep chain: 1,000 nodes', () => deepChain(1))
scenario('wide diamond: 1,000 middles', (counts) => diamond(counts, 1))

scenario('conditional dependencies', (counts) => {
	const store = createStore()
	const flag = primitiveAtom(false)
	const roots = [primitiveAtom(10), primitiveAtom(20)]
	const branches = roots.map((root) =>
		derivedAtom((read) => {
			counts.getters++
			return read(root) * 2
		}),
	)
	const conditional = derivedAtom((read) => {
		counts.getters++
		return read(branches[read(flag) ? 1 : 0]!)
	})
	const dispose = store.subscribe(conditional, () => {
		counts.subscribers++
	})
	let enabled = false
	return {
		stores: [store],
		update: () => {
			enabled = !enabled
			store.send(flag, enabled)
		},
		read: () => store.peek(conditional),
		verify: (value) => expect(value).toBe(enabled ? 40 : 20),
		dispose,
		operations: {
			getters: 1,
			invalidations: 2,
			validations: 1,
			notifications: 1,
		},
	}
})

scenario('equal-valued derived: 1,000 consumers', (counts) => {
	const store = createStore()
	const root = primitiveAtom(0)
	const middle = derivedAtom((read) => {
		counts.getters++
		return read(root) % 2
	})
	const consumers = Array.from({ length: 1_000 }, () =>
		derivedAtom((read) => {
			counts.getters++
			return read(middle) + 1
		}),
	)
	const disposers = consumers.map((consumer) =>
		store.subscribe(consumer, () => {
			counts.subscribers++
		}),
	)
	let next = 0
	return {
		stores: [store],
		update: () => {
			next += 2
			store.send(root, next)
		},
		read: () =>
			consumers.reduce((sum, consumer) => sum + store.peek(consumer), 0),
		verify: (value) => expect(value).toBe(1_000),
		dispose: () => {
			for (const dispose of disposers) dispose()
		},
		operations: {
			getters: 1,
			invalidations: 1_002,
			validations: 1_000,
			notifications: 1_000,
		},
	}
})

scenario('pending reads: 10 derived atoms', (counts) => {
	const store = createStore()
	const roots = Array.from({ length: 10 }, () => primitiveAtom(0))
	const derived = roots.map((root) =>
		derivedAtom((read) => {
			counts.getters++
			return read(root) * 2
		}),
	)
	const result = primitiveAtom(0)
	const setter = derivedAtom(null, (read, write, next: number) => {
		for (const root of roots) write(root, next)
		write(
			result,
			derived.reduce((sum, atom) => sum + read(atom), 0),
		)
	})
	for (const atom of derived) store.peek(atom)
	let next = 0
	return {
		stores: [store],
		update: () => store.send(setter, ++next),
		read: () => store.peek(result),
		verify: (value) => expect(value).toBe(next * 20),
		dispose: () => {},
		operations: { pendingGetters: 10, invalidations: 11 },
	}
})

scenario('cleanup-heavy: 100 mounted atoms', (counts) => {
	const store = createStore()
	const root = primitiveAtom(0)
	const atoms = Array.from({ length: 100 }, () =>
		derivedAtom(
			(read) => {
				counts.getters++
				return read(root)
			},
			null,
			{
				onMount: () => {
					counts.mounts++
					return () => {
						counts.cleanups++
					}
				},
			},
		),
	)
	const disposers = atoms.map((atom) =>
		store.subscribe(atom, () => {
			counts.subscribers++
		}),
	)
	for (const atom of atoms)
		disposers.push(
			store.mountEffect(
				effectAtom((read) => {
					read(atom)
					counts.effects++
					return () => {
						counts.cleanups++
					}
				}),
			),
		)
	let next = 0
	return {
		stores: [store],
		update: () => store.send(root, ++next),
		read: () => atoms.reduce((sum, atom) => sum + store.peek(atom), 0),
		verify: (value) => {
			expect(value).toBe(next * 100)
			expect(counts.mounts).toBe(100)
			expect(counts.effects).toBe((next + 1) * 100)
			expect(counts.cleanups).toBe(next * 100)
		},
		dispose: () => {
			for (const dispose of disposers) dispose()
		},
		operations: {
			getters: 100,
			invalidations: 201,
			notifications: 100,
			effects: 100,
			cleanups: 100,
		},
	}
})

for (const TTL of [0, Infinity]) {
	scenario(`families: 1,000 keys, TTL ${TTL}`, (counts) => {
		const store = createStore()
		const family = atomFamily(
			(key: number) =>
				derivedAtom(() => {
					counts.getters++
					return key
				}),
			{ TTL },
		)
		const keys = Array.from({ length: 1_000 }, (_, key) => key)
		for (const key of keys) store.resolve(family, key).peek()
		return {
			stores: [store],
			update: () => {},
			read: () =>
				keys.reduce((sum, key) => sum + store.resolve(family, key).peek(), 0),
			verify: (value) => expect(value).toBe(499_500),
			dispose: () => {},
			operations: { getters: TTL === 0 ? 1_000 : 0 },
		}
	})
}

scenario('many stores: deep chain over 100 stores', () => deepChain(100))
scenario('many stores: diamond over 100 stores', (counts) =>
	diamond(counts, 100),
)

scenario('pending reads: 21-node layered graph, read twice', () => {
	const store = createStore()
	const root = primitiveAtom(0)
	const top = layeredGraph(root)
	const result = primitiveAtom(0)
	const setter = derivedAtom(null, (read, write, next: number) => {
		write(root, next)
		write(result, read(top) + read(top))
	})
	store.peek(top)
	let next = 0
	return {
		stores: [store],
		update: () => store.send(setter, ++next),
		read: () => store.peek(result),
		verify: (value) => expect(value).toBe(next * 2_048),
		dispose: () => {},
		operations: { pendingGetters: 2 * 21, invalidations: 2 },
	}
})

scenario('unrelated write: 100-node unmounted chain', () => {
	const store = createStore()
	const root = primitiveAtom(0)
	const unrelated = primitiveAtom(0)
	const tip = chain(root, 100)
	store.peek(tip)
	let next = 0
	return {
		stores: [store],
		update: () => store.send(unrelated, ++next),
		read: () => store.peek(tip),
		verify: (value) => expect(value).toBe(100),
		dispose: () => {},
		operations: { invalidations: 1, validations: 100 },
	}
})
