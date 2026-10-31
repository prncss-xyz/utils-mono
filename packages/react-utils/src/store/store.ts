import {
	exhaustive,
	fromInit,
	id,
	isFunction,
	isoAssert,
	isReset,
	noop,
	type SetStateWithReset,
} from '../functions'

// NOTE: we are currently not handling the possibility that a user-supplied method (such as a getter or unmount) throws an exception. This is deliberately left for later.

export const TRANSIENT = -1

type FamilyStorage<Key> =
	| { type: 'hash'; map: Map<unknown, Instance<any>> }
	| { type: 'eq'; pairs: [Key, Instance<any>][] }

type FamilySlot =
	| (Extract<FamilyStorage<unknown>, { type: 'hash' }> & {
			hashedKey: unknown
	  })
	| Extract<FamilyStorage<unknown>, { type: 'eq' }>

type FamilyEntry = FamilySlot & { TTL: number }

type MountLifecycle = { cleanup?: () => void }
type EffectLifecycle<S> = MountLifecycle & {
	readonly value: S
	readonly instance: Instance<S>
	cleaning: boolean
	deferredReleases: Set<DeferredRelease>
	dependencies: Set<Instance<any>>
}

type DeferredRelease = {
	dependency: Instance<any>
	owners: Set<EffectLifecycle<any>>
}

type Registration = object

type Delivery = {
	instance: Instance<any>
	callback: () => void
	registration: Registration
}

type Freshness = { type: 'dirty' } | { type: 'clean'; validatedAt: number }

type Instance<S> = {
	handle: ResolvedAtom<S, any> | undefined
	symbol: AtomSymbol<any, any>
	familyEntry: FamilyEntry | undefined
	familyRemovalTimeout: ReturnType<typeof setTimeout> | undefined
	freshness: Freshness
	value: S
	effectLifecycle: EffectLifecycle<S> | undefined
	mountLifecycle: MountLifecycle | undefined
	version: number
	depVersions: Map<Instance<any>, number>
	mountedSubs: Set<Instance<any>>
	subscriptions: Map<() => void, Registration>
	mountCount: number
	mountedDeps: Set<Instance<any>>
	deferredOwners: Set<DeferredRelease>
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
	lookup: FamilyLookup<Key>
}

type FamilyLookup<Key> =
	| { type: 'hash'; hash: (k: Key) => unknown }
	| { type: 'eq'; eq: (a: Key, b: Key) => boolean }

export type AtomFamilyOptions<Key> = { TTL?: number } & (
	| { hash?: Extract<FamilyLookup<Key>, { type: 'hash' }>['hash']; eq?: never }
	| { eq?: Extract<FamilyLookup<Key>, { type: 'eq' }>['eq']; hash?: never }
)

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
 * TTL 0 evicts unwritten, unmounted entries in the next microtask. A first render
 * can peek before eviction and subscribe afterward; its re-resolving handle reaches
 * a new entry, costing one recreation and possibly an extra render for lazy primitives.
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
		TTL: opts?.TTL ?? 0,
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
	return [symbol, ...rest] as const
}

type Tasks = {
	mounts: Set<Instance<any>>
	primitives: Map<Instance<any>, any>
	effects: Set<Instance<any>>
	reconciles: Set<Instance<any>>
	pendingFamilyEvictions: Set<Instance<any>>
}

class Store {
	private contents = new WeakMap<any, any>()
	private epoch = 0
	private tasks: Tasks | undefined = undefined
	private mountWrites: Map<Instance<any>, any> | undefined
	private flushingMounts: Set<Instance<any>> | undefined
	private flushingEffects: Set<Instance<any>> | undefined
	private flushingReconciles: Set<Instance<any>> | undefined
	private flushingFamilyEvictions: Set<Instance<any>> | undefined
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
			reconciles: new Set(),
			pendingFamilyEvictions: new Set(),
		}
		if (!this.hydrating) queueMicrotask(this.flush.bind(this))
		return this.tasks
	}
	private getInstance<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
		key?: Key,
	): Instance<S> {
		if (symbol.type === 'family') {
			if (symbol.TTL < 0) return this.createFreshInstance(symbol, key!)
			const { lookup } = symbol
			switch (lookup.type) {
				case 'hash': {
					const storage = this.getFamilyStorage(symbol, () => ({
						type: 'hash',
						map: new Map(),
					}))
					isoAssert(storage.type === 'hash')
					const { map } = storage
					const hashedKey = lookup.hash(key!)
					return (
						map.get(hashedKey) ??
						this.createFamilyInstance(symbol, key!, (instance) => {
							map.set(hashedKey, instance)
							return { type: 'hash', map, hashedKey }
						})
					)
				}
				case 'eq': {
					const storage = this.getFamilyStorage(symbol, () => ({
						type: 'eq',
						pairs: [],
					}))
					isoAssert(storage.type === 'eq')
					const { pairs } = storage
					return (
						pairs.find(([k]) => lookup.eq(k, key!))?.[1] ??
						this.createFamilyInstance(symbol, key!, (instance) => {
							pairs.push([key!, instance])
							return { type: 'eq', pairs }
						})
					)
				}
				default:
					return exhaustive(lookup)
			}
		}
		let res = this.contents.get(symbol)
		if (res === undefined) {
			res = this.createInstance(symbol)
			this.contents.set(symbol, res)
		}
		return res
	}
	private getFamilyStorage<Key>(
		symbol: AtomFamily<any, Key, any>,
		init: () => FamilyStorage<Key>,
	): FamilyStorage<Key> {
		let storage: FamilyStorage<Key> | undefined = this.contents.get(symbol)
		if (storage === undefined) {
			storage = init()
			this.contents.set(symbol, storage)
		}
		return storage
	}
	private createFamilyInstance<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
		register: (instance: Instance<S>) => FamilySlot,
	): Instance<S> {
		const instance = this.createFreshInstance(symbol, key)
		const slot = register(instance)
		if (symbol.TTL < Infinity) {
			instance.familyEntry = { ...slot, TTL: symbol.TTL }
			this.getTasks().pendingFamilyEvictions.add(instance)
		}
		return instance
	}
	private createFreshInstance<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
	): Instance<S> {
		const created = symbol.create(key)
		isoAssert(
			!this.contents.has(created),
			'atomFamily create must return a fresh symbol on every call',
		)
		const instance = this.createInstance(created)
		this.contents.set(created, instance)
		return instance
	}
	private createInstance<S, Args extends unknown[]>(
		symbol: AtomSymbol<S, Args>,
	): Instance<S> {
		return {
			handle: undefined,
			symbol,
			familyEntry: undefined,
			familyRemovalTimeout: undefined,
			freshness:
				symbol.type === 'derived'
					? { type: 'dirty' }
					: { type: 'clean', validatedAt: -1 },
			value:
				symbol.type === 'primitive'
					? fromInit(symbol.getter)
					: (undefined as any),
			effectLifecycle: undefined,
			mountLifecycle: undefined,
			version: 0,
			depVersions: new Map(),
			mountedSubs: new Set(),
			subscriptions: new Map(),
			mountCount: 0,
			mountedDeps: new Set(),
			deferredOwners: new Set(),
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
	private enqueueReconcile<S>(instance: Instance<S>) {
		if (instance.symbol.type !== 'derived') return
		;(this.flushingReconciles ?? this.getTasks().reconciles).add(instance)
	}
	private invalidate<S>(instance: Instance<S>, affected: Set<Instance<any>>) {
		if (affected.has(instance)) return
		affected.add(instance)
		if (instance.symbol.type === 'derived')
			instance.freshness = { type: 'dirty' }
		if (instance.mountCount > 0) {
			this.enqueueReconcile(instance)
			this.enqueueEffect(instance)
		}
		for (const sub of instance.mountedSubs) this.invalidate(sub, affected)
	}
	/**
	 * Delivers to a snapshot of subscription registrations. A registration
	 * removed or replaced before its turn is skipped; one created during
	 * delivery (including a re-subscription by the same callback) waits for a
	 * later notification.
	 */
	private notify(roots: Iterable<Instance<any>>) {
		const affected = new Set<Instance<any>>()
		for (const root of roots) this.invalidate(root, affected)
		const deliveries: Delivery[] = []
		for (const instance of affected)
			for (const [callback, registration] of instance.subscriptions)
				deliveries.push({ instance, callback, registration })
		for (const { instance, callback, registration } of deliveries)
			if (instance.subscriptions.get(callback) === registration) callback()
	}
	private cancelEviction<S>(instance: Instance<S>) {
		this.tasks?.pendingFamilyEvictions.delete(instance)
		this.flushingFamilyEvictions?.delete(instance)
		if (instance.familyRemovalTimeout !== undefined) {
			clearTimeout(instance.familyRemovalTimeout)
			instance.familyRemovalTimeout = undefined
		}
	}
	/**
	 * `peekInstance` must run while the instance is still unmounted, so that a
	 * stale unmounted cache is revalidated before it starts receiving updates.
	 * A nested retain during that peek is counted by the post-increment.
	 */
	private retain<S>(instance: Instance<S>) {
		if (instance.mountCount === 0) {
			this.cancelEviction(instance)
			this.peekInstance(instance)
		}
		if (instance.mountCount++ > 0) return
		this.syncMountedDeps(instance)
		if (instance.mountCount === 0) return
		;(this.flushingMounts ?? this.getTasks().mounts).add(instance)
		this.enqueueEffect(instance)
	}
	private mount<S>(instance: Instance<S>) {
		if (instance.mountCount === 0 || instance.mountLifecycle) return
		const lifecycle: MountLifecycle = {}
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
		if (--instance.mountCount > 0) {
			this.releaseUnowned(instance)
			return
		}
		const mountedDeps = this.detachMountedDeps(instance)
		const mountLifecycle = instance.mountLifecycle
		instance.mountLifecycle = undefined
		const effectLifecycle = instance.effectLifecycle
		instance.effectLifecycle = undefined
		if (effectLifecycle) this.cleanupEffect(effectLifecycle, mountLifecycle)
		else mountLifecycle?.cleanup?.()
		if (instance.familyEntry)
			this.getTasks().pendingFamilyEvictions.add(instance)
		for (const dep of mountedDeps) this.release(dep)
	}
	private syncMountedDeps<S>(instance: Instance<S>) {
		for (const dep of instance.depVersions.keys()) {
			if (instance.mountCount === 0) return
			this.link(instance, dep)
		}
		// Releasing a dependency can run user cleanup that changes this graph.
		for (const dep of Array.from(instance.mountedDeps)) {
			if (instance.mountCount === 0) return
			if (instance.depVersions.has(dep)) continue
			this.unlink(instance, dep)
		}
	}
	/**
	 * Swaps out the mounted dependency set and clears the reverse links. It
	 * must run before any user callback can change dependencies or remount.
	 */
	private detachMountedDeps<S>(instance: Instance<S>) {
		const mountedDeps = instance.mountedDeps
		instance.mountedDeps = new Set()
		for (const dep of mountedDeps) dep.mountedSubs.delete(instance)
		return mountedDeps
	}
	private link<S>(instance: Instance<S>, dep: Instance<any>) {
		if (instance.mountedDeps.has(dep)) return
		instance.mountedDeps.add(dep)
		dep.mountedSubs.add(instance)
		this.retain(dep)
	}
	private unlink<S>(instance: Instance<S>, dep: Instance<any>) {
		if (!instance.mountedDeps.delete(dep)) return
		const owners = new Set<EffectLifecycle<any>>()
		const visited = new Set<Instance<any>>()
		const collect = (consumer: Instance<any>) => {
			if (visited.has(consumer)) return
			visited.add(consumer)
			const lifecycle = consumer.effectLifecycle
			if (lifecycle && (lifecycle.cleanup || lifecycle.cleaning))
				owners.add(lifecycle)
			for (const deferred of consumer.deferredOwners)
				for (const owner of deferred.owners) owners.add(owner)
			for (const sub of consumer.mountedSubs) collect(sub)
		}
		collect(instance)
		dep.mountedSubs.delete(instance)
		if (owners.size === 0) this.release(dep)
		else {
			const deferred: DeferredRelease = { dependency: dep, owners }
			dep.deferredOwners.add(deferred)
			for (const owner of owners) owner.deferredReleases.add(deferred)
		}
	}
	private getCleanupOrder(instances: Iterable<Instance<any>>) {
		const cleanupInstances = new Map<EffectLifecycle<any>, Instance<any>>()
		for (const instance of instances)
			if (instance.effectLifecycle)
				cleanupInstances.set(instance.effectLifecycle, instance)
		const dependencies = new Map<
			EffectLifecycle<any>,
			Set<EffectLifecycle<any>>
		>()
		const deferredDependencies: [EffectLifecycle<any>, EffectLifecycle<any>][] =
			[]
		const collect = (lifecycle: EffectLifecycle<any>) => {
			if (dependencies.has(lifecycle)) return
			const deps = new Set<EffectLifecycle<any>>()
			dependencies.set(lifecycle, deps)
			const collectDependency = (
				dependency: Instance<any>,
				deferred: boolean,
				visited = new Set<Instance<any>>(),
			): void => {
				if (visited.has(dependency)) return
				visited.add(dependency)
				const dependencyLifecycle = dependency.effectLifecycle
				if (dependencyLifecycle) {
					if (deferred)
						deferredDependencies.push([lifecycle, dependencyLifecycle])
					else deps.add(dependencyLifecycle)
					collect(dependencyLifecycle)
				} else
					for (const dep of dependency.mountedDeps)
						collectDependency(dep, deferred, visited)
			}
			for (const dependency of lifecycle.dependencies)
				collectDependency(dependency, false)
			for (const { dependency } of lifecycle.deferredReleases)
				collectDependency(dependency, true)
		}
		for (const lifecycle of cleanupInstances.keys()) collect(lifecycle)
		const reaches = (
			from: EffectLifecycle<any>,
			to: EffectLifecycle<any>,
			visited = new Set<EffectLifecycle<any>>(),
		): boolean => {
			if (from === to) return true
			if (visited.has(from)) return false
			visited.add(from)
			for (const dependency of dependencies.get(from)!)
				if (reaches(dependency, to, visited)) return true
			return false
		}
		for (const [lifecycle, dependency] of deferredDependencies)
			if (!reaches(dependency, lifecycle))
				dependencies.get(lifecycle)!.add(dependency)
		const cleanupOrder: Instance<any>[] = []
		const visited = new Set<EffectLifecycle<any>>()
		const order = (lifecycle: EffectLifecycle<any>) => {
			if (visited.has(lifecycle)) return
			visited.add(lifecycle)
			for (const dependency of dependencies.get(lifecycle)!) order(dependency)
			const instance = cleanupInstances.get(lifecycle)
			if (instance) cleanupOrder.push(instance)
		}
		for (const lifecycle of cleanupInstances.keys()) order(lifecycle)
		return cleanupOrder
	}
	private unownedComponent(instance: Instance<any>) {
		const component = new Set<Instance<any>>()
		const collect = (current: Instance<any>): boolean => {
			if (component.has(current)) return true
			component.add(current)
			if (
				current.mountCount >
				current.mountedSubs.size + current.deferredOwners.size
			)
				return false
			for (const consumer of current.mountedSubs)
				if (!collect(consumer)) return false
			for (const deferred of current.deferredOwners)
				for (const owner of deferred.owners)
					if (
						owner.cleaning ||
						owner.instance.effectLifecycle !== owner ||
						!collect(owner.instance)
					)
						return false
			return true
		}
		return collect(instance) ? component : undefined
	}
	private releaseUnowned(instance: Instance<any>) {
		const component = this.unownedComponent(instance)
		if (!component) return
		const order = this.getCleanupOrder(component)
		for (let index = order.length - 1; index >= 0; index--) {
			const consumer = order[index]!
			if (consumer.mountCount === 0 || !this.unownedComponent(consumer))
				continue
			const lifecycle = consumer.effectLifecycle
			const mountLifecycle = consumer.mountLifecycle
			consumer.effectLifecycle = undefined
			consumer.mountLifecycle = undefined
			if (lifecycle) this.cleanupEffect(lifecycle, mountLifecycle)
			else mountLifecycle?.cleanup?.()
			if (consumer.mountCount > 0) {
				;(this.flushingMounts ?? this.getTasks().mounts).add(consumer)
				this.enqueueEffect(consumer)
			}
		}
	}
	private cleanupEffect(
		lifecycle: EffectLifecycle<any>,
		mountLifecycle?: MountLifecycle,
	) {
		if (lifecycle.cleaning) {
			mountLifecycle?.cleanup?.()
			return
		}
		const cleanup = lifecycle.cleanup
		lifecycle.cleanup = undefined
		lifecycle.cleaning = true
		cleanup?.()
		mountLifecycle?.cleanup?.()
		for (const deferred of lifecycle.deferredReleases) {
			lifecycle.deferredReleases.delete(deferred)
			deferred.owners.delete(lifecycle)
			if (deferred.owners.size === 0) {
				deferred.dependency.deferredOwners.delete(deferred)
				this.release(deferred.dependency)
			}
		}
		lifecycle.dependencies.clear()
		lifecycle.cleaning = false
	}
	private runEffect<S>(
		instance: Instance<S>,
		effect: Effect<S> | undefined,
		next: S,
	) {
		const previous = instance.effectLifecycle
		const last = previous?.value
		if (previous) this.cleanupEffect(previous)
		const lifecycle: EffectLifecycle<S> = {
			value: next,
			instance,
			cleaning: false,
			deferredReleases: new Set(),
			dependencies: new Set(),
		}
		const visited = new Set<Instance<any>>()
		const collect = (dependency: Instance<any>) => {
			if (visited.has(dependency)) return
			visited.add(dependency)
			if (dependency.effectLifecycle) {
				lifecycle.dependencies.add(dependency)
				return
			}
			for (const dep of dependency.mountedDeps) collect(dep)
		}
		for (const dep of instance.mountedDeps) collect(dep)
		instance.effectLifecycle = lifecycle
		const cleanup = effect?.(
			next,
			last,
			this.peek.bind(this),
			this.send.bind(this),
		)
		if (cleanup) {
			if (instance.effectLifecycle === lifecycle) lifecycle.cleanup = cleanup
			else cleanup()
		}
	}
	private flush() {
		isoAssert(this.tasks, 'unexpected call to flush')
		const { mounts, primitives, effects, reconciles, pendingFamilyEvictions } =
			this.tasks
		const mountWrites = new Map<Instance<any>, any>()
		this.tasks = undefined
		this.flushingMounts = mounts
		this.flushingEffects = effects
		this.flushingReconciles = reconciles
		this.flushingFamilyEvictions = pendingFamilyEvictions
		const applyUpdates = (pending: Map<Instance<any>, any>) => {
			while (pending.size > 0) {
				const updates = [...pending]
				pending.clear()
				const changed: Instance<any>[] = []
				for (const [instance, next] of updates)
					if (!Object.is(next, instance.value)) {
						instance.value = next
						this.publishChange(instance)
						changed.push(instance)
					}
				this.notify(changed)
			}
		}
		const mount = (instance: Instance<any>) => {
			if (instance.mountCount === 0 || instance.mountLifecycle) {
				mounts.delete(instance)
				return
			}
			this.peekInstance(instance)
			for (const dep of instance.depVersions.keys()) mount(dep)
			mounts.delete(instance)
			this.mountWrites = mountWrites
			this.mount(instance)
			this.mountWrites = undefined
			// Mount writes must settle before consumers mount or effects run.
			applyUpdates(mountWrites)
		}
		const reconcile = (instance: Instance<any>) => {
			if (!reconciles.delete(instance)) return
			for (const sub of Array.from(instance.mountedSubs)) reconcile(sub)
			if (instance.mountCount > 0) this.peekInstance(instance)
		}
		applyUpdates(primitives)
		do {
			applyUpdates(mountWrites)
			for (const instance of reconciles) reconcile(instance)
			for (const instance of mounts) mount(instance)
		} while (mountWrites.size > 0 || mounts.size > 0 || reconciles.size > 0)
		this.flushingMounts = undefined
		this.flushingReconciles = undefined
		const visited = new Set<Instance<any>>()
		const transitions: { instance: Instance<any>; next: any }[] = []
		const collect = (instance: Instance<any>) => {
			if (visited.has(instance) || instance.mountCount === 0) return
			visited.add(instance)
			const next = this.peekInstance(instance)
			for (const dep of instance.depVersions.keys()) collect(dep)
			if (
				effects.has(instance) &&
				(!instance.effectLifecycle ||
					!Object.is(next, instance.effectLifecycle.value))
			)
				transitions.push({ instance, next })
		}
		for (const instance of effects) collect(instance)
		this.flushingEffects = undefined
		const cleanupOrder = this.getCleanupOrder(
			transitions.map(({ instance }) => instance),
		)
		// Release consumers before the resources provided by their dependencies.
		for (let index = cleanupOrder.length - 1; index >= 0; index--) {
			const instance = cleanupOrder[index]!
			if (instance.mountCount === 0) continue
			const lifecycle = instance.effectLifecycle
			if (lifecycle) this.cleanupEffect(lifecycle)
		}
		// Recreate dependency resources before their consumers run.
		for (const { instance, next } of transitions)
			if (instance.mountCount > 0)
				this.runEffect(instance, instance.symbol.effect, next)
		for (const instance of pendingFamilyEvictions) {
			if (instance.mountCount > 0) continue
			const { familyEntry } = instance
			isoAssert(familyEntry)
			const { TTL } = familyEntry
			if (TTL === 0) {
				this.evict(instance)
				continue
			}
			isoAssert(instance.familyRemovalTimeout === undefined)
			instance.familyRemovalTimeout = setTimeout(() => {
				instance.familyRemovalTimeout = undefined
				isoAssert(instance.mountCount === 0)
				this.evict(instance)
			}, TTL)
		}
		this.flushingFamilyEvictions = undefined
	}
	private evict<S>(instance: Instance<S>) {
		const entry = instance.familyEntry
		isoAssert(entry)
		instance.familyEntry = undefined
		switch (entry.type) {
			case 'hash': {
				isoAssert(entry.map.get(entry.hashedKey) === instance)
				entry.map.delete(entry.hashedKey)
				break
			}
			case 'eq': {
				const index = entry.pairs.findIndex(([, value]) => value === instance)
				isoAssert(index !== -1)
				entry.pairs.splice(index, 1)
				break
			}
			default:
				return exhaustive(entry)
		}
		isoAssert(
			instance.mountedSubs.size === 0,
			'evicting an instance with dependants',
		)
		this.publishChange(instance)
		instance.depVersions.clear()
		if (instance.symbol.type === 'derived')
			instance.freshness = { type: 'dirty' }
	}
	private peekInstance<S>(instance: Instance<S>) {
		const { symbol } = instance
		if (symbol.type === 'derived') this.revalidateUnmounted(instance)
		if (instance.freshness.type === 'dirty') {
			instance.freshness = { type: 'clean', validatedAt: -1 }
			switch (symbol.type) {
				case 'primitive':
					instance.value = fromInit(symbol.getter)
					return instance.value
				case 'derived': {
					instance.depVersions = new Map()
					const read = (<T, Key, Args extends unknown[]>(
						target: AtomFamily<T, Key, Args> | AtomSymbol<T, Args>,
						key?: Key,
					) => {
						const dep = this.getInstance(target, key)
						const value = this.peekInstance(dep)
						instance.depVersions.set(dep, dep.version)
						return value
					}) as Read
					const previous = instance.value
					const next = symbol.getter(read)
					instance.value = next
					if (!Object.is(next, previous)) this.advanceDerivedVersion(instance)
					instance.freshness = { type: 'clean', validatedAt: this.epoch }
					if (instance.mountCount > 0) this.syncMountedDeps(instance)
					return instance.value
				}
				default:
					return exhaustive(symbol)
			}
		}
		return instance.value
	}
	/**
	 * Publishes a change of this instance's value: bumps its version and
	 * advances `epoch` so unmounted dependants re-check their dependencies.
	 * Commits and evictions use it; derived recomputes use
	 * `advanceDerivedVersion`, which never advances `epoch`.
	 */
	private publishChange<S>(instance: Instance<S>) {
		instance.version++
		this.epoch++
	}
	private advanceDerivedVersion<S>(instance: Instance<S>) {
		instance.version++
	}
	/**
	 * Whether the instance is mounted or already validated at the current
	 * epoch. It must be re-checked after `depsAreCurrent`, because nested
	 * peeks can mount or revalidate the instance.
	 */
	private isFresh<S>(instance: Instance<S>) {
		return (
			instance.mountCount > 0 ||
			(instance.freshness.type === 'clean' &&
				instance.freshness.validatedAt === this.epoch)
		)
	}
	private revalidateUnmounted<S>(instance: Instance<S>) {
		if (instance.freshness.type === 'dirty' || this.isFresh(instance)) return
		const current = this.depsAreCurrent(instance)
		if (this.isFresh(instance)) return
		if (current) instance.freshness = { type: 'clean', validatedAt: this.epoch }
		else instance.freshness = { type: 'dirty' }
	}
	private depsAreCurrent<S>(instance: Instance<S>) {
		for (const [dep, version] of instance.depVersions) {
			if (dep.version !== version) return false
			this.peekInstance(dep)
			if (dep.version !== version) return false
		}
		return true
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
		if (symbol.type === 'primitive' || symbol.getter !== noread)
			this.cancelEviction(instance)
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
		if (instance.subscriptions.has(notify)) return noop
		const registration = {}
		instance.subscriptions.set(notify, registration)
		this.retain(instance)
		return () => {
			if (instance.subscriptions.get(notify) !== registration) return
			instance.subscriptions.delete(notify)
			this.release(instance)
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
