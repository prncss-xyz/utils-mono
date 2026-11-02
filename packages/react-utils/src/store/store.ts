import {
	exhaustive,
	fromInit,
	isFunction,
	isoAssert,
	isReset,
} from '../functions'
import {
	noread,
	type AtomFamily,
	type AtomSymbol,
	type Effect,
	type Hydrate,
	type Read,
	type ResolvedAtom,
	type ValidHydrate,
	type Write,
} from './atoms'
import { getCleanupOrder, unownedComponent } from './runtime/cleanupOrder'
import type {
	DeferredRelease,
	Delivery,
	EffectLifecycle,
	FamilySlot,
	FamilyStorage,
	Instance,
	MountLifecycle,
	Tasks,
	Transition,
} from './runtime/types'

// NOTE: we are currently not handling the possibility that a user-supplied method (such as a getter or unmount) throws an exception. This is deliberately left for later.

export {
	TRANSIENT,
	atomFamily,
	derivedAtom,
	hydrate,
	primitiveAtom,
	type AtomFamily,
	type AtomFamilyOptions,
	type AtomOptions,
	type AtomSymbol,
	type Effect,
	type Hydrate,
	type OnMount,
	type PrimitiveSymbol,
	type Read,
	type ResolvedAtom,
	type ValidHydrate,
	type Write,
} from './atoms'

class Store {
	private instances = new WeakMap<AtomSymbol<any, any>, Instance<any>>()
	private families = new WeakMap<
		AtomFamily<any, any, any>,
		FamilyStorage<any, any>
	>()
	private pendingEvaluations = new Set<Instance<any>>()
	private epoch = 0
	private tasks: Tasks | undefined = undefined
	private mountWrites: Map<Instance<any>, any> | undefined
	private flushingMounts: Set<Instance<any>> | undefined
	private flushingEffects: Set<Instance<any>> | undefined
	private flushingReconciles: Set<Instance<any>> | undefined
	private flushingFamilyEvictions: Set<Instance<any>> | undefined
	private hydrating = true
	private read: Read = this.peek.bind(this)
	private write: Write = this.send.bind(this)
	constructor(hydrate: Hydrate = []) {
		for (const entry of hydrate) {
			const [symbol, ...rest] = entry
			this.dispatch(
				symbol as AtomSymbol<any, any> | AtomFamily<any, any, any>,
				rest,
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
			if (symbol.retention.type === 'transient')
				return this.createFreshInstance(symbol, key!)
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
		let res = this.instances.get(symbol) as Instance<S> | undefined
		if (res === undefined) {
			res = this.createInstance(symbol)
			this.instances.set(symbol, res)
		}
		return res
	}
	private getFamilyStorage<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		init: () => FamilyStorage<S, Key>,
	): FamilyStorage<S, Key> {
		let storage = this.families.get(symbol) as FamilyStorage<S, Key> | undefined
		if (storage === undefined) {
			storage = init()
			this.families.set(symbol, storage)
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
		const { retention } = symbol
		isoAssert(retention.type !== 'transient')
		switch (retention.type) {
			case 'immediate':
			case 'timed':
				instance.familyEntry = { ...slot, retention }
				this.getTasks().pendingFamilyEvictions.add(instance)
				break
			case 'permanent':
				break
			default:
				return exhaustive(retention)
		}
		return instance
	}
	private createFreshInstance<S, Key, Args extends unknown[]>(
		symbol: AtomFamily<S, Key, Args>,
		key: Key,
	): Instance<S> {
		const created = symbol.create(key)
		isoAssert(
			!this.instances.has(created),
			'atomFamily create must return a fresh symbol on every call',
		)
		const instance = this.createInstance(created)
		this.instances.set(created, instance)
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
		const cleanup = instance.symbol.onMount?.(this.read, this.write)
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
	private releaseUnowned(instance: Instance<any>) {
		const component = unownedComponent(instance)
		if (!component) return
		const order = getCleanupOrder(component)
		for (let index = order.length - 1; index >= 0; index--) {
			const consumer = order[index]!
			if (consumer.mountCount === 0 || !unownedComponent(consumer)) continue
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
		effect: Effect<S>,
		next: S,
		last: S | undefined,
	) {
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
		const cleanup = effect(next, last, this.read, this.write)
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
		this.settle(primitives, mounts, reconciles, mountWrites)
		const transitions = this.collectTransitions(effects)
		this.runCleanups(transitions)
		this.runTransitions(transitions)
		this.scheduleEvictions(pendingFamilyEvictions)
	}
	private applyUpdates(pending: Map<Instance<any>, any>) {
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
	private settleMount(
		instance: Instance<any>,
		mounts: Set<Instance<any>>,
		mountWrites: Map<Instance<any>, any>,
	) {
		if (instance.mountCount === 0 || instance.mountLifecycle) {
			mounts.delete(instance)
			return
		}
		this.peekInstance(instance)
		for (const dep of instance.depVersions.keys())
			this.settleMount(dep, mounts, mountWrites)
		mounts.delete(instance)
		this.mountWrites = mountWrites
		this.mount(instance)
		this.mountWrites = undefined
		// Mount writes must settle before consumers mount or effects run.
		this.applyUpdates(mountWrites)
	}
	private reconcile(instance: Instance<any>, reconciles: Set<Instance<any>>) {
		if (!reconciles.delete(instance)) return
		for (const sub of Array.from(instance.mountedSubs))
			this.reconcile(sub, reconciles)
		if (instance.mountCount > 0) this.peekInstance(instance)
	}
	private settle(
		primitives: Map<Instance<any>, any>,
		mounts: Set<Instance<any>>,
		reconciles: Set<Instance<any>>,
		mountWrites: Map<Instance<any>, any>,
	) {
		this.applyUpdates(primitives)
		do {
			this.applyUpdates(mountWrites)
			for (const instance of reconciles) this.reconcile(instance, reconciles)
			for (const instance of mounts)
				this.settleMount(instance, mounts, mountWrites)
		} while (mountWrites.size > 0 || mounts.size > 0 || reconciles.size > 0)
		this.flushingMounts = undefined
		this.flushingReconciles = undefined
	}
	private collectTransitions(effects: Set<Instance<any>>): Transition[] {
		const visited = new Set<Instance<any>>()
		const transitions: Transition[] = []
		const collect = (instance: Instance<any>) => {
			if (visited.has(instance) || instance.mountCount === 0) return
			visited.add(instance)
			const next = this.peekInstance(instance)
			for (const dep of instance.depVersions.keys()) collect(dep)
			if (
				effects.has(instance) &&
				(!instance.effectLifecycle ||
					!Object.is(next, instance.effectLifecycle.value))
			) {
				const effect = instance.symbol.effect
				isoAssert(effect)
				transitions.push({
					instance,
					effect,
					next,
					previous: instance.effectLifecycle,
					mountLifecycle: instance.mountLifecycle,
				})
			}
		}
		for (const instance of effects) collect(instance)
		this.flushingEffects = undefined
		return transitions
	}
	private runCleanups(transitions: Transition[]) {
		const cleanupOrder = getCleanupOrder(
			transitions.map(({ instance }) => instance),
		)
		// Release consumers before the resources provided by their dependencies.
		for (let index = cleanupOrder.length - 1; index >= 0; index--) {
			const instance = cleanupOrder[index]!
			if (instance.mountCount === 0) continue
			const lifecycle = instance.effectLifecycle
			if (lifecycle) this.cleanupEffect(lifecycle)
		}
	}
	private runTransitions(transitions: Transition[]) {
		// Recreate dependency resources before their consumers run.
		for (const {
			instance,
			effect,
			next,
			previous,
			mountLifecycle,
		} of transitions)
			if (
				instance.mountCount > 0 &&
				instance.mountLifecycle === mountLifecycle &&
				instance.effectLifecycle === previous
			)
				this.runEffect(instance, effect, next, previous?.value)
	}
	private scheduleEvictions(pendingFamilyEvictions: Set<Instance<any>>) {
		for (const instance of pendingFamilyEvictions) {
			if (instance.mountCount > 0) continue
			const { familyEntry } = instance
			isoAssert(familyEntry)
			const { retention } = familyEntry
			switch (retention.type) {
				case 'immediate':
					this.evict(instance)
					break
				case 'timed':
					isoAssert(instance.familyRemovalTimeout === undefined)
					instance.familyRemovalTimeout = setTimeout(() => {
						instance.familyRemovalTimeout = undefined
						isoAssert(instance.mountCount === 0)
						this.evict(instance)
					}, retention.ms)
					break
				default:
					exhaustive(retention)
			}
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
		isoAssert(
			instance.freshness.type !== 'evaluating',
			'cyclic atom dependency',
		)
		const { symbol } = instance
		if (symbol.type === 'derived') this.revalidateUnmounted(instance)
		if (instance.freshness.type === 'dirty') {
			isoAssert(symbol.type === 'derived')
			instance.freshness = { type: 'evaluating' }
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
		isoAssert(!this.pendingEvaluations.has(instance), 'cyclic atom dependency')
		this.pendingEvaluations.add(instance)
		const value = instance.symbol.getter(this.readPending)
		this.pendingEvaluations.delete(instance)
		return value
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
				symbol.setter(this.readPending, this.write, ...args)
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
		this.dispatch(symbol, rest)
	}
	private dispatch(
		symbol: AtomFamily<any, any, any> | AtomSymbol<any, any>,
		rest: readonly unknown[],
	) {
		const key = symbol.type === 'family' ? rest[0] : undefined
		const args = symbol.type === 'family' ? rest.slice(1) : rest
		this.sendInstance(this.getInstance(symbol, key), args)
	}
	private subscribeInstance<S>(instance: Instance<S>, notify: () => void) {
		let registration = instance.subscriptions.get(notify)
		if (!registration) {
			registration = { references: 0 }
			instance.subscriptions.set(notify, registration)
		}
		registration.references++
		this.retain(instance)
		let active = true
		return () => {
			if (!active) return
			active = false
			if (--registration.references === 0) instance.subscriptions.delete(notify)
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
		if (symbol.type !== 'family' || symbol.retention.type === 'transient') {
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
	/**
	 * Each call owns a reference and returns an independently idempotent disposer.
	 * Distinct active callbacks run once per update; only the final reference removes
	 * a callback and releases its subscription ownership. Delivery uses a snapshot:
	 * new callbacks wait for a later update, and callbacks removed before their turn
	 * are skipped even if re-registered. Resolved handles share this contract.
	 */
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
