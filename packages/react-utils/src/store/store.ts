import {
	exhaustive,
	fromInit,
	id,
	isFunction,
	isoAssert,
	isReset,
	type SetStateWithReset,
} from '../functions'

function call(cb: () => void) {
	cb()
}

export const TRANSIENT = -1

type FamilyEntry = {
	entry: Map<unknown, Instance<any>>
	hashedKey: unknown
	TTL: number
}

type Instance<S> = {
	handle: ResolvedAtom<S, any> | undefined
	symbol: AtomSymbol<any, any>
	familyEntries: FamilyEntry[]
	familyRemovalTimeouts: Map<ReturnType<typeof setTimeout>, FamilyEntry>
	dirty: boolean
	value: S
	effectValue: S | undefined
	effectActive: boolean
	effectCleanup: (() => void) | undefined
	mountLifecycle: { cleanup?: () => void } | undefined
	deps: Set<Instance<any>>
	subs: Set<Instance<any>>
	subscriptions: Set<() => void>
	mountCount: number
	mountedDeps: Set<Instance<any>>
}

export type AtomOptions<S> = {
	effect?: Effect<S>
	onMount?: OnMount
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
	TTL: number
	hash: (k: Key) => unknown
}

export type Read = {
	<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
	): S
	<S, Args extends unknown[]>(symbol: AtomSymbol<S, Args>): S
}
export type Write = {
	<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
		...args: Args
	): void
	<S, Args extends unknown[]>(symbol: AtomSymbol<S, Args>, ...args: Args): void
}
export type Hydrate = readonly HydrateEntry[]
// Effect<never> is contravariant, so write-only atoms need their own catch-all.
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
export type Effect<S> = (
	next: S,
	last: S | undefined,
	/** Read an atom without tracking it as a dependency. */
	get: Read,
	set: Write,
) => void | (() => void)

/** Runs in the effect microtask after the first subscription; cleans up on last release. */
export type OnMount = (get: Read, set: Write) => void | (() => void)

export type ResolvedAtom<S, Args extends unknown[]> = {
	peek: () => S
	send: (...args: Args) => void
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

function noread(): never {
	throw new Error('you cannot read this atom')
}

function nowrite(): never {
	throw new Error('you cannot write this atom')
}

/**
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

/**
 * The `create` factory must return a fresh, unique symbol on every call,
 * including when it recreates the same key after an eviction.
 */
export function atomFamily<S, K, Args extends unknown[]>(
	create: (key: K) => AtomSymbol<S, Args>,
	opts?: Partial<{ TTL: number; hash: (k: K) => unknown }>,
): AtomFamily<S, K, Args> {
	return {
		type: 'family' as const,
		create,
		TTL: opts?.TTL ?? 0,
		hash: opts?.hash ?? id,
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
	return [symbol, ...rest] as const
}

type Tasks = {
	mounts: Set<Instance<any>>
	primitives: Map<Instance<any>, any>
	effects: Set<Instance<any>>
	unmountedFamilyEntries: Set<Instance<any>>
}

class Store {
	private contents = new WeakMap<any, any>()
	private tasks: Tasks | undefined = undefined
	private mountWrites: Map<Instance<any>, any> | undefined
	private flushingMounts: Set<Instance<any>> | undefined
	private flushingEffects: Set<Instance<any>> | undefined
	private hydrating = true
	constructor(hydrate: Hydrate = []) {
		for (const entry of hydrate) {
			const [symbol, ...rest] = entry
			const key = symbol.type === 'family' ? rest[0] : undefined
			const args = symbol.type === 'family' ? rest.slice(1) : rest
			this.sendInstance(
				this.getInstance(
					symbol as AtomSymbol<any, any> | AtomFamily<any, any, any>,
					key,
				),
				args,
			)
		}
		if (this.tasks) this.flush()
		this.hydrating = false
	}
	private getTasks(): Tasks {
		if (this.tasks) return this.tasks
		this.tasks = {
			mounts: new Set(),
			primitives: new Map(),
			effects: new Set(),
			unmountedFamilyEntries: new Set(),
		}
		if (!this.hydrating) queueMicrotask(this.flush.bind(this))
		return this.tasks
	}
	private getInstance<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
		key?: Key,
	): Instance<S> {
		if (symbol.type === 'family') {
			if (symbol.TTL < 0) return this.getInstance(symbol.create(key!))
			let entry: Map<unknown, Instance<S>> | undefined =
				this.contents.get(symbol)
			if (entry === undefined) {
				entry = new Map()
				this.contents.set(symbol, entry)
			}
			const hashedKey = symbol.hash(key!)
			let res = entry.get(hashedKey)
			if (res === undefined) {
				res = this.getInstance(symbol.create(key!))
				entry.set(hashedKey, res)
				res.familyEntries.push({ entry, hashedKey, TTL: symbol.TTL })
			}
			return res
		}
		let res = this.contents.get(symbol)
		if (res === undefined) {
			res = this.createInstance(symbol)
			this.contents.set(symbol, res)
		}
		return res
	}
	private createInstance<S, Args extends unknown[]>(
		symbol: AtomSymbol<S, Args>,
	): Instance<S> {
		return {
			handle: undefined,
			symbol,
			familyEntries: [],
			familyRemovalTimeouts: new Map(),
			dirty: symbol.type === 'derived',
			value:
				symbol.type === 'primitive'
					? fromInit(symbol.getter)
					: (undefined as any),
			effectValue: undefined,
			effectActive: false,
			effectCleanup: undefined,
			mountLifecycle: undefined,
			deps: new Set(),
			subs: new Set(),
			subscriptions: new Set(),
			mountCount: 0,
			mountedDeps: new Set(),
		}
	}
	private enqueueEffect<S>(instance: Instance<S>) {
		if (!instance.symbol.effect) return
		if (this.flushingEffects) {
			this.flushingEffects.add(instance)
			return
		}
		this.getTasks().effects.add(instance)
	}
	private notify<S>(instance: Instance<S>) {
		if (instance.symbol.type === 'derived') instance.dirty = true
		if (instance.mountCount > 0) this.enqueueEffect(instance)
		// A subscriber can recompute and re-add itself while being notified.
		for (const sub of Array.from(instance.subs)) this.notify(sub)
		instance.subscriptions.forEach(call)
	}
	private retain<S>(instance: Instance<S>) {
		if (instance.mountCount++ > 0) return
		this.peekInstance(instance)
		this.syncMountedDeps(instance)
		for (const [timeout, familyEntry] of instance.familyRemovalTimeouts) {
			clearTimeout(timeout)
			instance.familyEntries.push(familyEntry)
		}
		instance.familyRemovalTimeouts.clear()
		if (instance.mountCount === 0) return
		;(this.flushingMounts ?? this.getTasks().mounts).add(instance)
		this.enqueueEffect(instance)
	}
	private mount<S>(instance: Instance<S>) {
		if (instance.mountCount === 0 || instance.mountLifecycle) return
		const lifecycle: { cleanup?: () => void } = {}
		instance.mountLifecycle = lifecycle
		const cleanup = instance.symbol.onMount?.(
			this.peek.bind(this),
			this.send.bind(this),
		)
		if (cleanup) {
			if (instance.mountLifecycle === lifecycle) lifecycle.cleanup = cleanup
			else cleanup()
		}
	}
	private release<S>(instance: Instance<S>) {
		if (--instance.mountCount > 0) return
		// Detach ownership before user callbacks can change dependencies or remount.
		const mountedDeps = instance.mountedDeps
		instance.mountedDeps = new Set()
		const lifecycle = instance.mountLifecycle
		instance.mountLifecycle = undefined
		const cleanup = instance.effectCleanup
		instance.effectCleanup = undefined
		instance.effectValue = undefined
		instance.effectActive = false
		cleanup?.()
		lifecycle?.cleanup?.()
		if (instance.familyEntries.length > 0)
			this.getTasks().unmountedFamilyEntries.add(instance)
		for (const dep of mountedDeps) this.release(dep)
	}
	private syncMountedDeps<S>(instance: Instance<S>) {
		for (const dep of instance.deps) {
			if (instance.mountCount === 0) return
			if (instance.mountedDeps.has(dep)) continue
			instance.mountedDeps.add(dep)
			this.retain(dep)
		}
		// Releasing a dependency can run user cleanup that changes this graph.
		for (const dep of Array.from(instance.mountedDeps)) {
			if (instance.mountCount === 0) return
			if (instance.deps.has(dep)) continue
			if (instance.mountedDeps.delete(dep)) this.release(dep)
		}
	}
	private runEffect<S>(
		instance: Instance<S>,
		effect: Effect<S> | undefined,
		next: S,
	) {
		const last = instance.effectValue
		instance.effectValue = next
		instance.effectActive = true
		const cleanup = instance.effectCleanup
		instance.effectCleanup = undefined
		cleanup?.()
		instance.effectCleanup =
			effect?.(next, last, this.peek.bind(this), this.send.bind(this)) ||
			undefined
	}
	private flush() {
		isoAssert(this.tasks, 'unexpected call to flush')
		const { mounts, primitives, effects, unmountedFamilyEntries } = this.tasks
		const mountWrites = new Map<Instance<any>, any>()
		this.tasks = undefined
		this.flushingMounts = mounts
		this.flushingEffects = effects
		const applyUpdates = (pending: Map<Instance<any>, any>) => {
			while (pending.size > 0) {
				const updates = [...pending]
				pending.clear()
				for (const [instance, next] of updates)
					if (!Object.is(next, instance.value)) {
						instance.value = next
						this.notify(instance)
					}
			}
		}
		const mount = (instance: Instance<any>) => {
			if (instance.mountCount === 0 || instance.mountLifecycle) {
				mounts.delete(instance)
				return
			}
			this.peekInstance(instance)
			for (const dep of instance.deps) mount(dep)
			mounts.delete(instance)
			this.mountWrites = mountWrites
			this.mount(instance)
			this.mountWrites = undefined
			// Mount writes must settle before consumers mount or effects run.
			applyUpdates(mountWrites)
		}
		applyUpdates(primitives)
		do {
			applyUpdates(mountWrites)
			for (const instance of effects)
				if (instance.mountCount > 0) this.peekInstance(instance)
			for (const instance of mounts) mount(instance)
		} while (mountWrites.size > 0 || mounts.size > 0)
		this.flushingMounts = undefined
		const visited = new Set<Instance<any>>()
		const transitions: { instance: Instance<any>; next: any }[] = []
		const collect = (instance: Instance<any>) => {
			if (visited.has(instance) || instance.mountCount === 0) return
			visited.add(instance)
			const next = this.peekInstance(instance)
			for (const dep of instance.deps) collect(dep)
			if (
				effects.has(instance) &&
				(!instance.effectActive || !Object.is(next, instance.effectValue))
			)
				transitions.push({ instance, next })
		}
		for (const instance of effects) collect(instance)
		this.flushingEffects = undefined
		// Release consumers before the resources provided by their dependencies.
		for (let index = transitions.length - 1; index >= 0; index--) {
			const { instance } = transitions[index]!
			if (instance.mountCount === 0) continue
			const cleanup = instance.effectCleanup
			instance.effectCleanup = undefined
			cleanup?.()
		}
		// Recreate dependency resources before their consumers run.
		for (const { instance, next } of transitions)
			if (instance.mountCount > 0)
				this.runEffect(instance, instance.symbol.effect, next)
		for (const instance of unmountedFamilyEntries) {
			if (instance.mountCount > 0) continue
			for (const familyEntry of instance.familyEntries) {
				const { TTL } = familyEntry
				if (TTL === Infinity) continue
				if (TTL === 0) {
					this.evict(instance, familyEntry)
					continue
				}
				const timeout = setTimeout(() => {
					instance.familyRemovalTimeouts.delete(timeout)
					if (instance.mountCount === 0) this.evict(instance, familyEntry)
				}, TTL)
				instance.familyRemovalTimeouts.set(timeout, familyEntry)
			}
			instance.familyEntries = []
		}
	}
	private evict<S>(instance: Instance<S>, { entry, hashedKey }: FamilyEntry) {
		if (entry.get(hashedKey) !== instance) return
		entry.delete(hashedKey)
		for (const sub of Array.from(instance.subs)) this.notify(sub)
		instance.subs.clear()
		for (const dep of instance.deps) dep.subs.delete(instance)
		instance.deps.clear()
		if (instance.symbol.type === 'derived') instance.dirty = true
	}
	private peekInstance<S>(instance: Instance<S>) {
		const { symbol } = instance
		if (instance.dirty) {
			instance.dirty = false
			switch (symbol.type) {
				case 'primitive':
					instance.value = fromInit(symbol.getter)
					return instance.value
				case 'derived': {
					const previousDeps = instance.deps
					instance.deps = new Set()
					const read = (<T, Key, Args extends unknown[]>(
						target: AtomFamily<T, Key, Args> | AtomSymbol<T, Args>,
						key?: Key,
					) => {
						const dep = this.getInstance(target, key)
						instance.deps.add(dep)
						dep.subs.add(instance)
						return this.peekInstance(dep)
					}) as Read
					instance.value = symbol.getter(read)
					for (const dep of previousDeps)
						if (!instance.deps.has(dep)) dep.subs.delete(instance)
					if (instance.mountCount > 0) this.syncMountedDeps(instance)
					return instance.value
				}
				default:
					return exhaustive(symbol)
			}
		}
		return instance.value
	}
	peek<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
	): S
	peek<S, Args extends unknown[]>(symbol: AtomSymbol<S, Args>): S
	peek<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
		key?: Key,
	) {
		const instance = this.getInstance(symbol, key)
		return this.peekInstance(instance)
	}
	/** Setters read the pending state; public reads keep the committed snapshot. */
	private readPending: Read = <S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
		key?: Key,
	): S => {
		const instance = this.getInstance(symbol, key)
		const pending = this.mountWrites ?? this.tasks?.primitives
		if (!pending?.size) return this.peekInstance(instance)
		if (instance.symbol.type === 'primitive')
			return pending.has(instance)
				? pending.get(instance)
				: this.peekInstance(instance)
		return instance.symbol.getter(this.readPending)
	}
	private sendInstance<S>(instance: Instance<S>, args: readonly unknown[]) {
		const { symbol } = instance
		switch (symbol.type) {
			case 'primitive': {
				const event = args[0]
				const primitives = this.mountWrites ?? this.getTasks().primitives
				const next = isFunction(event)
					? event(this.readPending(symbol))
					: isReset(event)
						? fromInit(symbol.getter)
						: event
				primitives.set(instance, next)
				return
			}
			case 'derived': {
				symbol.setter(this.readPending, this.send.bind(this), ...args)
				return
			}
			default:
				return exhaustive(symbol)
		}
	}
	send<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
		...args: Args
	): void
	send<S, Args extends unknown[]>(
		symbol: AtomSymbol<S, Args>,
		...args: Args
	): void
	send(
		symbol: AtomFamily<any, any, any> | AtomSymbol<any, any>,
		...rest: unknown[]
	): void {
		const key = symbol.type === 'family' ? rest[0] : undefined
		const args = symbol.type === 'family' ? rest.slice(1) : rest
		this.sendInstance(this.getInstance(symbol, key), args)
	}
	private subscribeInstance<S>(instance: Instance<S>, notify: () => void) {
		const subscribed = !instance.subscriptions.has(notify)
		if (subscribed) {
			instance.subscriptions.add(notify)
			this.retain(instance)
		}
		let active = subscribed
		return () => {
			if (!active) return
			active = false
			if (instance.subscriptions.delete(notify)) this.release(instance)
		}
	}
	resolve<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
	): ResolvedAtom<S, Args>
	resolve<S, Args extends unknown[]>(
		symbol: AtomSymbol<S, Args>,
	): ResolvedAtom<S, Args>
	resolve<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
		key?: Key,
	): ResolvedAtom<S, Args> {
		const instance = this.getInstance(symbol, key)
		if (instance.handle) return instance.handle
		if (symbol.type !== 'family' || symbol.TTL < 0) {
			return (instance.handle = {
				peek: () => this.peekInstance(instance),
				send: (...args) => this.sendInstance(instance, args),
				subscribe: (notify) => this.subscribeInstance(instance, notify),
			})
		}
		return (instance.handle = {
			peek: () => this.peekInstance(this.getInstance(symbol, key)),
			send: (...args) => this.sendInstance(this.getInstance(symbol, key), args),
			subscribe: (notify) =>
				this.subscribeInstance(this.getInstance(symbol, key), notify),
		})
	}
	subscribe<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
		notify: () => void,
	): () => void
	subscribe<S, Args extends unknown[]>(
		symbol: AtomSymbol<S, Args>,
		notify: () => void,
	): () => void
	subscribe<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
		keyOrNotify: Key | (() => void),
		notify?: () => void,
	): () => void {
		const instance = this.getInstance(symbol, keyOrNotify as Key)
		const callback =
			symbol.type === 'family' ? notify! : (keyOrNotify as () => void)
		return this.subscribeInstance(instance, callback)
	}
}

export function createStore(): Store
export function createStore<
	const Entries extends readonly (readonly unknown[])[],
>(hydrate: Entries & ValidHydrate<Entries>): Store
export function createStore(hydrate?: Hydrate) {
	return new Store(hydrate)
}
