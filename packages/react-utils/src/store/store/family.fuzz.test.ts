import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

import {
	atomFamily,
	createStore,
	derivedAtom,
	primitiveAtom,
	type ResolvedAtom,
} from '.'
import type { SetStateWithReset } from '../../functions'
import { type Value } from './utils.testing'

type Key = { id: number }
type Handle = ResolvedAtom<string, [SetStateWithReset<string>]>

const id = fc.integer({ min: 0, max: 2 })
const target = {
	id,
	via: fc.boolean(),
	slot: fc.nat({ max: 20 }),
}
const operation = fc.oneof(
	{
		weight: 4,
		arbitrary: fc.record({ type: fc.constant('peek' as const), ...target }),
	},
	{
		weight: 3,
		arbitrary: fc.record({ type: fc.constant('send' as const), ...target }),
	},
	{
		weight: 3,
		arbitrary: fc.record({
			type: fc.constant('subscribe' as const),
			...target,
		}),
	},
	{
		weight: 2,
		arbitrary: fc.record({ type: fc.constant('resolve' as const), id }),
	},
	{
		weight: 3,
		arbitrary: fc.record({
			type: fc.constant('unsubscribe' as const),
			slot: fc.nat({ max: 20 }),
		}),
	},
	{ weight: 5, arbitrary: fc.record({ type: fc.constant('yield' as const) }) },
	{
		weight: 3,
		arbitrary: fc.record({
			type: fc.constant('advance' as const),
			ms: fc.integer({ min: 1, max: 4 }),
		}),
	},
)

type Subscriber = { calls: number; expected: number }
type Entry = {
	value: string
	pending: string | undefined
	references: number
	eviction: 'none' | 'queued' | { deadline: number }
	handle: Handle | undefined
	subscribers: Subscriber[]
}

/**
 * Models the eviction policy of a family: a member created by any access is
 * queued for eviction, a first mount or a write cancels that, the last release
 * queues it again, and eviction removes it in the next microtask (TTL 0) or
 * after the TTL has elapsed. Kept handles re-resolve to the current member.
 */
async function run(
	TTL: number,
	lookup: 'hash' | 'eq',
	operations: Value<typeof operation>[],
) {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
	let creations = 0
	const create = (key: Key) => {
		creations++
		return primitiveAtom(`${key.id}#${creations}`)
	}
	const family = atomFamily(create, {
		TTL,
		...(lookup === 'hash'
			? { hash: (key: Key) => key.id }
			: { eq: (a: Key, b: Key) => a.id === b.id }),
	})
	const readers = [0, 1, 2].map((key) =>
		derivedAtom((read) => read(family, { id: key })),
	)
	const store = createStore()
	const transient = TTL < 0
	let modelCreations = 0
	let now = 0
	const entries = new Map<number, Entry>()
	const seenHandles = new Map<number, Handle[]>()
	const handles: { id: number; real: Handle; entry: Entry | undefined }[] = []
	const subscriptions: {
		entry: Entry
		subscriber: Subscriber
		release: () => void
	}[] = []
	let counter = 0

	const newEntry = (key: number, eviction: Entry['eviction']): Entry => ({
		value: `${key}#${++modelCreations}`,
		pending: undefined,
		references: 0,
		eviction,
		handle: undefined,
		subscribers: [],
	})
	const access = (key: number) => {
		let entry = entries.get(key)
		if (!entry) {
			entry = newEntry(key, TTL === Infinity ? 'none' : 'queued')
			entries.set(key, entry)
		}
		return entry
	}
	const transientEntries = new Set<Entry>()
	const derivedReads = new Map<number, Entry>()
	const readDerived = (key: number) => {
		const cached = derivedReads.get(key)
		if (transient) {
			if (cached) return cached.value
			const entry = newEntry(key, 'none')
			derivedReads.set(key, entry)
			return entry.value
		}
		if (cached && entries.get(key) === cached) return cached.value
		const entry = access(key)
		derivedReads.set(key, entry)
		return entry.value
	}
	const resolveTarget = (step: {
		id: number
		via: boolean
		slot: number
	}): { entry: Entry; real: Handle | undefined; key: number } => {
		if (step.via && handles.length > 0) {
			const handle = handles[step.slot % handles.length]!
			return {
				entry: handle.entry ?? access(handle.id),
				real: handle.real,
				key: handle.id,
			}
		}
		return {
			entry: transient ? newEntry(step.id, 'none') : access(step.id),
			real: undefined,
			key: step.id,
		}
	}
	const history: string[] = []
	const report = (label: string) => `${label}\n${history.join('\n')}`

	try {
		const finish: Value<typeof operation>[] = [
			{ type: 'yield' },
			{ type: 'advance', ms: 10 },
			{ type: 'peek', id: 0, via: false, slot: 0 },
			{ type: 'peek', id: 1, via: false, slot: 0 },
			{ type: 'peek', id: 2, via: false, slot: 0 },
		]
		let index = 0
		const execute = (step: Value<typeof operation>) => {
			let settled: Promise<void> | undefined
			const label = `step ${index++} ${JSON.stringify(step)}`
			history.push(label)
			switch (step.type) {
				case 'peek': {
					const { entry, real, key } = resolveTarget(step)
					const actual = real ? real.peek() : store.peek(family, { id: key })
					expect(actual, report(label)).toBe(entry.value)
					expect(
						store.peek(readers[key]!),
						report(`${label}: derived reader`),
					).toBe(readDerived(key))
					break
				}
				case 'send': {
					const { entry, real, key } = resolveTarget(step)
					const next = `v${++counter}`
					if (real) real.send(next)
					else store.send(family, { id: key }, next)
					entry.pending = next
					entry.eviction = 'none'
					break
				}
				case 'subscribe': {
					const { entry, real, key } = resolveTarget(step)
					const subscriber = { calls: 0, expected: 0 }
					const notify = () => subscriber.calls++
					const release = real
						? real.subscribe(notify)
						: store.subscribe(family, { id: key }, notify)
					if (entry.references === 0) entry.eviction = 'none'
					entry.references++
					entry.subscribers.push(subscriber)
					subscriptions.push({ entry, subscriber, release })
					break
				}
				case 'resolve': {
					const real = store.resolve(family, { id: step.id })
					const known = seenHandles.get(step.id) ?? []
					if (transient) {
						const entry = newEntry(step.id, 'none')
						transientEntries.add(entry)
						handles.push({ id: step.id, real, entry })
						expect(known, report(label)).not.toContain(real)
						known.push(real)
					} else {
						const entry = access(step.id)
						if (entry.handle) expect(real, report(label)).toBe(entry.handle)
						else {
							expect(known, report(label)).not.toContain(real)
							entry.handle = real
							known.push(real)
						}
						handles.push({ id: step.id, real, entry: undefined })
					}
					seenHandles.set(step.id, known)
					break
				}
				case 'unsubscribe': {
					if (subscriptions.length === 0) break
					const [{ entry, subscriber, release }] = subscriptions.splice(
						step.slot % subscriptions.length,
						1,
					) as [(typeof subscriptions)[number]]
					release()
					entry.references--
					entry.subscribers.splice(entry.subscribers.indexOf(subscriber), 1)
					if (entry.references === 0 && !transient && TTL !== Infinity)
						entry.eviction = 'queued'
					break
				}
				case 'yield': {
					for (const entry of [...entries.values(), ...transientEntries])
						if (entry.pending !== undefined) {
							if (entry.pending !== entry.value)
								for (const subscriber of entry.subscribers)
									subscriber.expected++
							entry.value = entry.pending
							entry.pending = undefined
						}
					for (const [key, entry] of entries)
						if (entry.eviction === 'queued')
							if (TTL === 0) entries.delete(key)
							else entry.eviction = { deadline: now + TTL }
					settled = Promise.resolve()
					break
				}
				case 'advance': {
					now += step.ms
					vi.advanceTimersByTime(step.ms)
					for (const [key, entry] of entries)
						if (
							typeof entry.eviction === 'object' &&
							entry.eviction.deadline <= now
						)
							entries.delete(key)
					break
				}
			}
			const verify = () => {
				expect(creations, report(`${label}: members created`)).toBe(
					modelCreations,
				)
				for (const { subscriber } of subscriptions)
					expect(subscriber.calls, report(`${label}: notifications`)).toBe(
						subscriber.expected,
					)
			}
			if (!settled) return verify()
			return settled.then(verify)
		}
		for (const step of operations) {
			const pending = execute(step)
			if (pending) await pending
		}
		while (subscriptions.length > 0)
			void execute({ type: 'unsubscribe', slot: 0 })
		for (const step of finish) {
			const pending = execute(step)
			if (pending) await pending
		}
	} finally {
		vi.useRealTimers()
	}
}

describe.each([-1, 0, 5, Infinity])('family with TTL %s', (TTL) => {
	it.each(['hash', 'eq'] as const)(
		'follows the eviction policy and keeps handles usable (%s lookup)',
		async (lookup) => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(operation, { maxLength: 40, size: 'max' }),
					(operations) => run(TTL, lookup, operations),
				),
				{ numRuns: 200 },
			)
		},
		15_000,
	)
})
