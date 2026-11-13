import { describe, expect, it } from 'vitest'

import { atomFamily, derivedAtom, effectAtom, primitiveAtom } from '.'
import { createStore, flushMicrotask } from './utils.testing'

/** Settles with the promise's value, or with `'pending'` once timers run. */
function beforeTimers<T>(promise: Promise<T>): Promise<T | 'pending'> {
	return Promise.race([
		promise,
		new Promise<'pending'>((resolve) => setTimeout(resolve, 0, 'pending')),
	])
}

function writeChain() {
	const source = primitiveAtom(0)
	const relayed = primitiveAtom(0)
	const effected = primitiveAtom(0)
	const store = createStore()
	store.subscribe(source, () => store.send(relayed, store.peek(source) + 1))
	store.mountEffect(
		effectAtom(
			(read) => read(relayed),
			(next, _last, _read, write) => write(effected, next * 10),
		),
	)
	return { store, source, relayed, effected }
}

describe('settled', () => {
	it('resolves on a settled store', async () => {
		const store = createStore()

		expect(await beforeTimers(store.settled().then(() => 'settled'))).toBe(
			'settled',
		)
	})

	it('resolves after writes made by subscribers and effects in later flushes have committed', async () => {
		const { store, source, relayed, effected } = writeChain()
		await store.settled()

		store.send(source, 1)
		const committed = store
			.settled()
			.then(() => [
				store.peek(source),
				store.peek(relayed),
				store.peek(effected),
			])

		expect(await beforeTimers(committed)).toEqual([1, 2, 20])
	})

	it('resolves every call made while work is queued', async () => {
		const { store, source, effected } = writeChain()
		store.send(source, 1)

		const calls = [store.settled(), store.settled()].map((promise) =>
			promise.then(() => store.peek(effected)),
		)

		expect(await beforeTimers(Promise.all(calls))).toEqual([20, 20])
	})

	it('waits for its own writes after an earlier call has resolved', async () => {
		const { store, source, effected } = writeChain()
		store.send(source, 1)
		await store.settled()

		store.send(source, 2)
		const committed = store.settled().then(() => store.peek(effected))

		expect(await beforeTimers(committed)).toBe(30)
	})

	it('waits for writes made later in the flush it was called from', async () => {
		const source = primitiveAtom(0)
		const relayed = primitiveAtom(0)
		const store = createStore()
		const calls: Promise<number>[] = []
		store.subscribe(source, () => {
			calls.push(store.settled().then(() => store.peek(relayed)))
		})
		store.subscribe(source, () => store.send(relayed, 1))
		await flushMicrotask()

		store.send(source, 1)
		await flushMicrotask()

		expect(await beforeTimers(Promise.all(calls))).toEqual([1])
	})

	it('does not wait for timed family evictions or timers started by subscribers', async () => {
		const members = atomFamily((_key: string) => primitiveAtom(0), {
			TTL: 60_000,
		})
		const source = primitiveAtom(0)
		const delayed = primitiveAtom(0)
		const store = createStore()
		const unsubscribe = store.subscribe(members, 'a', () => {})
		store.subscribe(source, () => {
			setTimeout(() => store.send(delayed, 1), 0)
		})
		await flushMicrotask()

		unsubscribe()
		store.send(source, 1)
		const committed = store.settled().then(() => store.peek(delayed))

		expect(await beforeTimers(committed)).toBe(0)
	})

	it('rejects calls from a getter', () => {
		const store = createStore()
		const calling = derivedAtom(() => {
			void store.settled()
			return 0
		})

		expect(() => store.peek(calling)).toThrow('getters must not call the store')
	})
})
