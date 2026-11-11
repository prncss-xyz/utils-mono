import { id, isoAssert, type SetStateWithReset } from '../functions'
import { untrackedRead } from './effectRead'

export const TRANSIENT = -1

export type FamilyRetention =
	| { type: 'transient' }
	| { type: 'immediate' }
	| { type: 'timed'; ms: number }
	| { type: 'permanent' }

declare const atomValue: unique symbol

export type AtomOptions<S> = {
	readonly [atomValue]?: S
	onMount?: OnMount
	/** Label under which opt-in operation counters report this atom's work. */
	name?: string
}

export type PrimitiveSymbol<S, Args extends unknown[]> = AtomOptions<S> & {
	type: 'primitive'
	getter: (() => S) | S
	readonly args?: Args
}

type DerivedSymbol<S, Args extends unknown[]> = AtomOptions<S> & {
	type: 'derived'
	getter: Getter<S>
	setter: Setter<Args>
}

export type AtomSymbol<S, Args extends unknown[]> =
	| PrimitiveSymbol<S, Args>
	| DerivedSymbol<S, Args>
export type AtomFamily<S, Key, Args extends unknown[]> = {
	type: 'family'
	create: (key: Key) => AtomSymbol<S, Args>
	retention: FamilyRetention
	lookup: FamilyLookup<Key>
}

type FamilyLookup<Key> =
	| { type: 'hash'; hash: (k: Key) => unknown }
	| { type: 'eq'; eq: (a: Key, b: Key) => boolean }

export type AtomFamilyOptions<Key> = { TTL?: number } & (
	| { hash?: Extract<FamilyLookup<Key>, { type: 'hash' }>['hash']; eq?: never }
	| { eq?: Extract<FamilyLookup<Key>, { type: 'eq' }>['eq']; hash?: never }
)

/**
 * Reads an atom. Call the `read` passed to a getter or effect tracker only
 * during that function's synchronous execution. Calls after it returns,
 * including after an `await` or from a deferred callback, are unsupported.
 * For asynchronous work, capture atom values during the synchronous call.
 */
export type Read = {
	<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
	): S
	<S, Args extends unknown[]>(symbol: AtomSymbol<S, Args>): S
}
/**
 * Writes are batched: a setter reads the pending value left by earlier writes in
 * the same microtask, so writes compose. Writes commit in one microtask, and
 * until then `peek` and subscribers see the old committed value, so
 * `send(x, 1); peek(x)` returns the previous value. A write made by a subscriber
 * or an effect is applied by a later microtask; a write made by `onMount`
 * settles within the mount phase, before the first tracked effect read returns.
 */
export type Write = {
	<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
		...args: Args
	): void
	<S, Args extends unknown[]>(symbol: AtomSymbol<S, Args>, ...args: Args): void
}
export type Resolve = {
	<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
	): ResolvedAtom<S, Args>
	<S, Args extends unknown[]>(
		symbol: AtomSymbol<S, Args>,
	): ResolvedAtom<S, Args>
}
/**
 * Each call owns a reference and returns an independently idempotent disposer.
 * Distinct active callbacks run once per update; only the final reference removes
 * a callback and releases its subscription ownership. Delivery uses a snapshot:
 * new callbacks wait for a later update, and callbacks removed before their turn
 * are skipped even if re-registered. Resolved handles share this contract.
 */
export type Subscribe = {
	<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
		notify: () => void,
	): () => void
	<S, Args extends unknown[]>(
		symbol: AtomSymbol<S, Args>,
		notify: () => void,
	): () => void
}
/**
 * `peek` returns committed values, `send` queues a write, and neither flushes
 * synchronously. See `Write` for when writes become visible.
 */
export type Store = {
	peek: Read
	send: Write
	resolve: Resolve
	subscribe: Subscribe
	mountEffect: (effect: EffectAtom) => () => void
}

export type Hydrate = readonly HydrateEntry[]
type HydrateEntry =
	| readonly [symbol: AtomSymbol<any, any>, ...args: any[]]
	| readonly [symbol: AtomSymbol<never, any>, ...args: any[]]
	| readonly [symbol: AtomFamily<any, any, any>, key: any, ...args: any[]]
	| readonly [symbol: AtomFamily<never, any, any>, key: any, ...args: any[]]
type ValidHydrateEntry<Entry> = Entry extends readonly [
	infer Symbol extends AtomFamily<any, any, any> | AtomFamily<never, any, any>,
	...unknown[],
]
	? [Symbol] extends [AtomFamily<infer _Value, infer Key, infer Args>]
		? readonly [Symbol, Key, ...Args]
		: never
	: Entry extends readonly [
				infer Symbol extends AtomSymbol<any, any> | AtomSymbol<never, any>,
				...unknown[],
		  ]
		? [Symbol] extends [AtomSymbol<infer _Value, infer Args>]
			? readonly [Symbol, ...Args]
			: never
		: never
export type ValidHydrate<Entries extends readonly (readonly unknown[])[]> = {
	readonly [Index in keyof Entries]: ValidHydrateEntry<Entries[Index]>
}
type Getter<S> = (read: Read) => S
type Setter<Args extends unknown[]> = (
	read: Read,
	write: Write,
	...args: Args
) => void
export type MountEffect = (effect: EffectAtom) => void
export type EffectTracker<S = void | (() => void)> = (read: Read) => S
export type EffectBody<S> = (
	next: S,
	last: S | undefined,
	read: Read,
	write: Write,
	mountEffect: MountEffect,
) => void | (() => void)
export type EffectAtom = { type: 'effect'; body: OnMount }

/**
 * Only the tracker declares dependencies. Call its `read` only during its
 * synchronous execution; calls after it returns, including after an `await` or
 * from a deferred callback, are unsupported. For asynchronous work, capture
 * atom values during the synchronous call. The body receives an untracked
 * `read` that reads current values, including from deferred work. The previous
 * tracked value is scoped to each store's mounted lifecycle and is undefined on
 * its first run. With one argument, the callback's reads are tracked.
 */
export function effectAtom<S>(
	tracker: EffectTracker<S>,
	body: EffectBody<S>,
): EffectAtom
export function effectAtom(tracker: EffectTracker): EffectAtom
export function effectAtom<S>(
	tracker: EffectTracker<S> | EffectTracker,
	body?: EffectBody<S>,
): EffectAtom {
	if (body) {
		return {
			type: 'effect',
			body: (_read, _write, mountEffect) => {
				let last: S | undefined
				mountEffect({
					type: 'effect',
					body: (read, write, mountEffect) => {
						const next = (tracker as EffectTracker<S>)(read)
						const cleanup = body(
							next,
							last,
							untrackedRead(read),
							write,
							mountEffect,
						)
						last = next
						return cleanup
					},
				})
			},
		}
	}
	return { type: 'effect', body: (read) => (tracker as EffectTracker)(read) }
}

/** Runs in the effect microtask after the first subscription; cleans up on last release. */
export type OnMount = (
	read: Read,
	write: Write,
	mountEffect: MountEffect,
) => void | (() => void)

export type ResolvedAtom<S, Args extends unknown[]> = {
	peek: () => S
	send: (...args: Args) => void
	/**
	 * Each call owns a reference and returns an independently idempotent disposer.
	 * Each distinct active callback runs once per update, even with multiple references.
	 * The final release removes the callback and releases its subscription ownership.
	 * Delivery uses a snapshot: new callbacks wait for a later update, and a callback
	 * removed before its turn is skipped, even if it is registered again.
	 */
	subscribe: (notify: () => void) => () => void
}

export function primitiveAtom<S>(
	getter: S | (() => S),
	opts?: AtomOptions<NoInfer<S>>,
): AtomSymbol<S, [SetStateWithReset<S>]> {
	return {
		type: 'primitive' as const,
		getter,
		...opts,
	}
}

export function noread(): never {
	throw new Error('you cannot read this atom')
}

function nowrite(): never {
	throw new Error('you cannot write this atom')
}

/**
 * Getters are pure in the way React render functions are: the result must
 * depend only on what the getter reads through its `read` argument, which plays
 * the role of hooks. Other user-supplied functions it calls are not checked, but
 * the runtime may run a getter any number of times and reuses its last result
 * while no dependency has changed, so impure inputs such as `Date.now()` give
 * stale or inconsistent values. A getter must not write, subscribe, peek, or
 * mount through the store by any other route: the store asserts that no getter
 * is running when one of those calls is made. After a getter throws, the store
 * is left in an undefined state and must not be used further. A getter that reads itself, directly or through other getters, is
 * rejected as a cyclic dependency. A promise returned by a getter is a plain
 * value: there is no cancellation, staleness handling, or Suspense support.
 *
 * Call the getter's `read` only during its synchronous execution. Calls after
 * it returns, including after an `await` or from a deferred callback, are
 * unsupported. For asynchronous work, capture atom values during the
 * synchronous call.
 *
 * Infers setter arguments as a tuple. When specifying the value type explicitly,
 * also specify the argument tuple (for example, derivedAtom<number, [n: number]>).
 * Omitting the setter creates a read-only atom.
 */
export function derivedAtom<S = never>(
	getter: Getter<S> | null | undefined,
	setter?: null | undefined,
	opts?: AtomOptions<NoInfer<S>>,
): AtomSymbol<S, never>
export function derivedAtom<S = never, Args extends unknown[] = []>(
	getter: Getter<S> | null | undefined,
	setter: Setter<Args>,
	opts?: AtomOptions<NoInfer<S>>,
): AtomSymbol<S, Args>
export function derivedAtom<S = never>(
	getter: Getter<S> | null | undefined,
	setter?: Setter<any> | null | undefined,
	opts?: AtomOptions<NoInfer<S>>,
): AtomSymbol<S, any> {
	return {
		type: 'derived' as const,
		getter: getter ?? noread,
		setter: setter ?? nowrite,
		...opts,
	}
}

function familyRetention(TTL: number): FamilyRetention {
	isoAssert(!Number.isNaN(TTL), 'atomFamily TTL must not be NaN')
	if (TTL < 0) return { type: 'transient' }
	if (TTL === 0) return { type: 'immediate' }
	if (TTL < Infinity) return { type: 'timed', ms: TTL }
	return { type: 'permanent' }
}

/**
 * For non-transient TTLs, writing a primitive or readable derived member cancels
 * its pending eviction, so a written member that is never mounted stays retained
 * indefinitely, even with TTL 0. Once such a member is mounted and released, it
 * follows the TTL like any other member. Applications that create unbounded keys
 * therefore grow memory with every key that is written and never mounted
 * afterward; the store offers no explicit removal.
 *
 * The `create` factory must return a fresh, unique symbol on every call,
 * including when it recreates the same key after an eviction.
 * Negative TTL values are transient; positive finite values expire after that
 * many milliseconds, and Infinity retains entries indefinitely. NaN is invalid.
 * TTL 0 evicts an unmounted entry in the next microtask, subject to the write
 * retention above. A first render can peek before eviction and subscribe
 * afterward; its re-resolving handle reaches a new entry, costing one
 * recreation and possibly an extra render for lazy primitives.
 * Keys are matched either by `hash` (default: identity), stored in a Map, or by
 * `eq`, stored as key/value pairs and resolved to the first stored key for which
 * `eq(stored, key)` holds; `hash` and `eq` are mutually exclusive. `eq` lookup is a
 * linear scan, and stored keys are kept by reference, so they must not be mutated.
 */
export function atomFamily<S, K, Args extends unknown[]>(
	create: (key: K) => AtomSymbol<S, Args>,
	opts?: AtomFamilyOptions<K>,
): AtomFamily<S, K, Args> {
	isoAssert(
		!(opts?.hash && opts?.eq),
		'atomFamily accepts either hash or eq, not both',
	)
	return {
		type: 'family' as const,
		create,
		retention: familyRetention(opts?.TTL ?? 0),
		lookup: opts?.eq
			? { type: 'eq', eq: opts.eq }
			: { type: 'hash', hash: opts?.hash ?? id },
	}
}

export function hydrate<S, Key, Args extends unknown[]>(
	symbol: AtomFamily<S, Key, Args>,
	key: NoInfer<Key>,
	...args: NoInfer<Args>
): readonly [AtomFamily<S, Key, Args>, Key, ...Args]
export function hydrate<S, Args extends unknown[]>(
	symbol: AtomSymbol<S, Args>,
	...args: NoInfer<Args>
): readonly [AtomSymbol<S, Args>, ...Args]
export function hydrate(
	symbol: AtomSymbol<any, any> | AtomFamily<any, any, any>,
	...rest: unknown[]
) {
	isoAssert(
		symbol.type === 'primitive' ||
			symbol.type === 'derived' ||
			symbol.type === 'family',
		'effect atoms have no value',
	)
	return [symbol, ...rest] as const
}
