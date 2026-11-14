import { describe, expect, it } from 'vitest'

import {
	createStore,
	derivedAtom,
	primitiveAtom,
	type AtomSymbol,
	type Store,
} from '.'
import { flushMicrotask } from './utils.testing'

const depth = 12000

function cachedChain(store: Store, events: number[], size = depth) {
	const source = primitiveAtom(0)
	const readValues: number[] = []
	let tip: AtomSymbol<number, never> = derivedAtom((read) => {
		const value = read(source)
		readValues.push(value)
		return value % 2
	})
	const nodes = [tip]
	store.peek(tip)
	for (let index = 1; index < size; index++) {
		const dependency = tip
		tip = derivedAtom((read) => read(dependency) + 1, undefined, {
			onMount: () => {
				events.push(index)
				return () => events.push(-index)
			},
		})
		nodes.push(tip)
		store.peek(tip)
	}
	return { source, tip, nodes, readValues }
}

async function mountedChain(store: Store, events: number[]) {
	const graph = cachedChain(store, events)
	const disposers = graph.nodes.map((node) => store.subscribe(node, () => {}))
	await flushMicrotask()
	const unsubscribe = disposers.pop()!
	for (const dispose of disposers) dispose()
	return { ...graph, unsubscribe }
}

describe('deep dependency graphs', () => {
	it('initially reads a new consumer of a cached chain after an unrelated commit', async () => {
		const store = createStore()
		const { tip } = cachedChain(store, [])
		const unrelated = primitiveAtom(0)
		store.send(unrelated, 1)
		await flushMicrotask()
		const consumer = derivedAtom((read) => read(tip) + 1)
		expect(store.peek(consumer)).toBe(depth)
	})

	it('updates a mounted chain whose intermediate value stays equal', async () => {
		const store = createStore()
		const { source, tip, readValues, unsubscribe } = await mountedChain(
			store,
			[],
		)
		store.send(source, 2)
		await flushMicrotask()
		expect(store.peek(tip)).toBe(depth - 1)
		expect(readValues).toEqual([0, 2])
		unsubscribe()
	})

	it('retains and mounts a cached chain in dependency order', async () => {
		const store = createStore()
		const events: number[] = []
		const size = 2000
		const { tip } = cachedChain(store, events, size)
		const unsubscribe = store.subscribe(tip, () => {})
		await flushMicrotask()
		expect(events).toEqual(
			Array.from({ length: size - 1 }, (_, index) => index + 1),
		)
		unsubscribe()
	})

	it('mounts a cached chain in dependency order', async () => {
		const store = createStore()
		const events: number[] = []
		const { tip, unsubscribe } = await mountedChain(store, events)
		const consumer = derivedAtom((read) => read(tip), undefined, {
			onMount: () => {
				events.push(depth)
			},
		})
		const unsubscribeConsumer = store.subscribe(consumer, () => {})
		await flushMicrotask()
		expect(events).toEqual(
			Array.from({ length: depth }, (_, index) => index + 1),
		)
		unsubscribeConsumer()
		unsubscribe()
	})

	it('disposes a mounted chain in consumer order', async () => {
		const store = createStore()
		const events: number[] = []
		const { unsubscribe } = await mountedChain(store, events)
		events.length = 0
		unsubscribe()
		expect(events).toEqual(
			Array.from({ length: depth - 1 }, (_, index) => index + 1 - depth),
		)
	})

	it('cleans up a dropped branch in consumer order', async () => {
		const store = createStore()
		const events: number[] = []
		const { tip, unsubscribe } = await mountedChain(store, events)
		const enabled = primitiveAtom(true)
		const consumer = derivedAtom((read) => (read(enabled) ? read(tip) : -1))
		const unsubscribeConsumer = store.subscribe(consumer, () => {})
		await flushMicrotask()
		unsubscribe()
		events.length = 0
		store.send(enabled, false)
		await flushMicrotask()
		expect(store.peek(consumer)).toBe(-1)
		expect(events).toEqual(
			Array.from({ length: depth - 1 }, (_, index) => index + 1 - depth),
		)
		unsubscribeConsumer()
	})
})
