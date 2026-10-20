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

type PrimitiveSymbol<S, E> = AtomOptions<S> & {
	type: 'primitive'
	getter: (() => S) | S
	readonly event?: E
}

type DerivedSymbol<S, E> = AtomOptions<S> & {
	type: 'derived'
	getter: Getter<S>
	setter: Setter<E>
}

export type AtomSymbol<S, E> = PrimitiveSymbol<S, E> | DerivedSymbol<S, E>
export type AtomFamily<S, Key, E> = {
	type: 'family'
	create: (key: Key) => AtomSymbol<S, E>
	TTL: number
	hash: (k: Key) => unknown
}

export type Read = {
	<S, Key, E>(symbol: AtomFamily<S, Key, E>, key: Key): S
	<S, E>(symbol: AtomSymbol<S, E>): S
}
export type Write = {
	<S, Key, E>(symbol: AtomFamily<S, Key, E>, key: Key, event: E): void
	<S, E>(symbol: AtomSymbol<S, E>, event: E): void
}
export type Hydrate = readonly HydrateEntry[]
type HydrateEntry =
	| readonly [symbol: AtomSymbol<any, any>, event: any]
	| readonly [symbol: AtomFamily<any, any, any>, key: any, event: any]
type ValidHydrateEntry<Entry> = Entry extends readonly [
	infer Symbol extends AtomFamily<any, any, any>,
	unknown,
	unknown,
]
	? [Symbol] extends [AtomFamily<any, infer Key, infer Event>]
		? readonly [Symbol, Key, Event]
		: never
	: Entry extends readonly [infer Symbol extends AtomSymbol<any, any>, unknown]
		? [Symbol] extends [AtomSymbol<any, infer Event>]
			? readonly [Symbol, Event]
			: never
		: never
type ValidHydrate<Entries extends readonly (readonly unknown[])[]> = {
	readonly [Index in keyof Entries]: ValidHydrateEntry<Entries[Index]>
}
type Getter<S> = (read: Read) => S
type Setter<E> = (read: Read, write: Write, e: E) => void
export type Effect<S> = (
	next: S,
	last: S | undefined,
	/** Read an atom without tracking it as a dependency. */
	get: Read,
	set: Write,
) => void | (() => void)

/** Runs in the effect microtask after the first subscription; cleans up on last release. */
export type OnMount = (get: Read, set: Write) => void | (() => void)

export type ResolvedAtom<S, E> = {
	peek: () => S
	send: (event: E) => void
	subscribe: (notify: () => void) => () => void
}

export function primitive<S>(
	getter: S | (() => S),
	opts?: AtomOptions<NoInfer<S>>,
): AtomSymbol<S, SetStateWithReset<S>> {
	return {
		type: 'primitive' as const,
		getter,
		...opts,
	}
}

export function derived<S, E>(
	getter: Getter<S>,
	setter: Setter<E>,
	opts?: AtomOptions<NoInfer<S>>,
): AtomSymbol<S, E> {
	return {
		type: 'derived' as const,
		getter,
		setter,
		...opts,
	}
}

export function family<S, K, E>(
	create: (key: K) => AtomSymbol<S, E>,
	opts?: Partial<{ TTL: number; hash: (k: K) => unknown }>,
): AtomFamily<S, K, E> {
	return {
		type: 'family' as const,
		create,
		TTL: opts?.TTL ?? 0,
		hash: opts?.hash ?? id,
	}
}

export function hydrate<S, E>(
	symbol: AtomSymbol<S, E>,
	event: NoInfer<E>,
): readonly [AtomSymbol<S, E>, E]
export function hydrate<S, Key, E>(
	symbol: AtomFamily<S, Key, E>,
	key: NoInfer<Key>,
	event: NoInfer<E>,
): readonly [AtomFamily<S, Key, E>, Key, E]
export function hydrate(
	symbol: AtomSymbol<any, any> | AtomFamily<any, any, any>,
	keyOrEvent: any,
	event?: any,
) {
	return symbol.type === 'family'
		? ([symbol, keyOrEvent, event] as const)
		: ([symbol, keyOrEvent] as const)
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
			const [symbol, keyOrEvent, event] = entry
			if (symbol.type === 'family') this.send(symbol, keyOrEvent, event)
			else this.send(symbol, keyOrEvent)
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
	private getInstance<S, Key, E>(
		symbol: AtomFamily<S, Key, E> | AtomSymbol<S, E>,
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
	private createInstance<S, E>(symbol: AtomSymbol<S, E>): Instance<S> {
		return {
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
			try {
				this.mount(instance)
			} finally {
				this.mountWrites = undefined
			}
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
				const { entry, hashedKey, TTL } = familyEntry
				if (TTL === Infinity) continue
				if (TTL === 0) {
					if (entry.get(hashedKey) === instance) entry.delete(hashedKey)
					continue
				}
				const timeout = setTimeout(() => {
					instance.familyRemovalTimeouts.delete(timeout)
					if (instance.mountCount === 0 && entry.get(hashedKey) === instance)
						entry.delete(hashedKey)
				}, TTL)
				instance.familyRemovalTimeouts.set(timeout, familyEntry)
			}
			instance.familyEntries = []
		}
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
					const read = (<T, Key, Event>(
						target: AtomFamily<T, Key, Event> | AtomSymbol<T, Event>,
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
	peek<S, Key, E>(symbol: AtomFamily<S, Key, E>, key: Key): S
	peek<S, E>(symbol: AtomSymbol<S, E>): S
	peek<S, Key, E>(symbol: AtomFamily<S, Key, E> | AtomSymbol<S, E>, key?: Key) {
		const instance = this.getInstance(symbol, key)
		return this.peekInstance(instance)
	}
	private sendInstance<S, E>(instance: Instance<S>, event: E) {
		const { symbol } = instance
		switch (symbol.type) {
			case 'primitive': {
				const primitives = this.mountWrites ?? this.getTasks().primitives
				let res: any
				if (isFunction(event)) {
					const last = primitives.has(instance)
						? primitives.get(instance)
						: this.peekInstance(instance)
					res = event(last)
				} else if (isReset(event)) {
					res = fromInit(symbol.getter)
				} else {
					res = event
				}
				primitives.set(instance, res)
				return
			}
			case 'derived': {
				symbol.setter(this.peek.bind(this), this.send.bind(this), event)
				return
			}
			default:
				return exhaustive(symbol)
		}
	}
	send<S, Key, E>(symbol: AtomFamily<S, Key, E>, key: Key, next: E): void
	send<S, E>(symbol: AtomSymbol<S, E>, next: E): void
	send<S, Key, E>(
		symbol: AtomFamily<S, Key, E> | AtomSymbol<S, E>,
		keyOrNext: Key | E,
		next?: E,
	): void {
		const instance = this.getInstance(symbol, keyOrNext as any)
		const event = symbol.type === 'family' ? next! : (keyOrNext as E)
		this.sendInstance(instance, event)
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
	resolve<S, Key, E>(
		symbol: AtomFamily<S, Key, E>,
		key: Key,
	): ResolvedAtom<S, E>
	resolve<S, E>(symbol: AtomSymbol<S, E>): ResolvedAtom<S, E>
	resolve<S, Key, E>(
		symbol: AtomFamily<S, Key, E> | AtomSymbol<S, E>,
		key?: Key,
	): ResolvedAtom<S, E> {
		const instance = this.getInstance(symbol, key)
		return {
			peek: () => this.peekInstance(instance),
			send: (event) => this.sendInstance(instance, event),
			subscribe: (notify) => this.subscribeInstance(instance, notify),
		}
	}
	subscribe<S, Key, E>(
		symbol: AtomFamily<S, Key, E>,
		key: Key,
		notify: () => void,
	): () => void
	subscribe<S, E>(symbol: AtomSymbol<S, E>, notify: () => void): () => void
	subscribe<S, Key, E>(
		symbol: AtomFamily<S, Key, E> | AtomSymbol<S, E>,
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
