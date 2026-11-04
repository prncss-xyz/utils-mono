import { expect, test } from 'vite-plus/test'

import {
	atomFamily,
	createStore,
	derivedAtom,
	primitiveAtom,
	type AtomSymbol,
} from '.'
import { flushMicrotask } from '../utils.testing'

type Counters = {
	getters: number
	subscribers: number
	effects: number
	mounts: number
	cleanups: number
}

type Scenario = {
	update: () => void
	read: () => number
	verify: (value: number) => void
	dispose: () => void
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
			graph.verify(value)
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
			update: () => {},
			read: () => (resolved ? handle.peek() : store.peek(cached)),
			verify: (value) => {
				expect(value).toBe(2)
				expect(counts.getters).toBe(1)
			},
			dispose: () => {},
		}
	})
}

function deepChain(counts: Counters, storeCount: number): Scenario {
	const root = primitiveAtom(0)
	let tip: AtomSymbol<number, never> = derivedAtom((read) => {
		counts.getters++
		return read(root) + 1
	})
	for (let index = 1; index < 1_000; index++) {
		const previous = tip
		tip = derivedAtom((read) => {
			counts.getters++
			return read(previous) + 1
		})
	}
	const stores = Array.from({ length: storeCount }, () => createStore())
	for (const store of stores) store.peek(tip)
	let next = 0
	return {
		update: () => {
			next++
			for (const store of stores) store.send(root, next)
		},
		read: () => stores.reduce((sum, store) => sum + store.peek(tip), 0),
		verify: (value) => expect(value).toBe((next + 1_000) * storeCount),
		dispose: () => {},
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
	}
}

scenario('deep chain: 1,000 nodes', (counts) => deepChain(counts, 1))
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
		update: () => {
			enabled = !enabled
			store.send(flag, enabled)
		},
		read: () => store.peek(conditional),
		verify: (value) => expect(value).toBe(enabled ? 40 : 20),
		dispose,
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
		update: () => store.send(setter, ++next),
		read: () => store.peek(result),
		verify: (value) => expect(value).toBe(next * 20),
		dispose: () => {},
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
				effect: () => {
					counts.effects++
					return () => {
						counts.cleanups++
					}
				},
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
	let next = 0
	return {
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
			update: () => {},
			read: () =>
				keys.reduce((sum, key) => sum + store.resolve(family, key).peek(), 0),
			verify: (value) => expect(value).toBe(499_500),
			dispose: () => {},
		}
	})
}

scenario('many stores: deep chain over 100 stores', (counts) =>
	deepChain(counts, 100),
)
scenario('many stores: diamond over 100 stores', (counts) =>
	diamond(counts, 100),
)
