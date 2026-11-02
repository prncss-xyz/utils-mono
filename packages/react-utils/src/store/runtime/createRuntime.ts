import {
	exhaustive,
	fromInit,
	isFunction,
	isoAssert,
	isReset,
} from '../../functions'
import {
	noread,
	type AtomFamily,
	type AtomSymbol,
	type Effect,
	type Hydrate,
	type Read,
	type Resolve,
	type Subscribe,
	type Store,
	type ResolvedAtom,
	type Write,
} from '../atoms'
import { getCleanupOrder, unownedComponent } from './cleanupOrder'
import type {
	DeferredRelease,
	Delivery,
	EffectLifecycle,
	FamilySlot,
	FamilyStorage,
	FlushPhase,
	Instance,
	MountLifecycle,
	Tasks,
	Transition,
} from './types'

export type StoreState = {
	instances: WeakMap<AtomSymbol<any, any>, Instance<any>>
	families: WeakMap<AtomFamily<any, any, any>, FamilyStorage<any, any>>
	pendingEvaluations: Set<Instance<any>>
	epoch: number
	/** Test instrumentation counting every dependency validation call. */
	validations: number
	tasks: Tasks | undefined
	phase: FlushPhase
	hydrating: boolean
	read: Read
	write: Write
	readPending: Read
	scheduleFlush: () => void
}

function createState(
	wiring: Pick<StoreState, 'read' | 'write' | 'readPending' | 'scheduleFlush'>,
): StoreState {
	isoAssert(wiring.read)
	isoAssert(wiring.write)
	isoAssert(wiring.readPending)
	isoAssert(wiring.scheduleFlush)
	return {
		instances: new WeakMap(),
		families: new WeakMap(),
		pendingEvaluations: new Set(),
		epoch: 0,
		validations: 0,
		tasks: undefined,
		phase: {
			mounts: undefined,
			reconciles: undefined,
			effects: undefined,
			familyEvictions: undefined,
			mountWrites: undefined,
		},
		hydrating: true,
		...wiring,
	}
}

export function createRuntime(hydrate: Hydrate = []): {
	store: Store
	state: StoreState
} {
	const state: StoreState = createState({
		read: ((symbol, key) =>
			peekInstance(state, getInstance(state, symbol, key))) as Read,
		write: ((
			symbol: AtomFamily<any, any, any> | AtomSymbol<any, any>,
			...rest: unknown[]
		) => dispatch(state, symbol, rest)) as Write,
		readPending: ((symbol, key) => readPending(state, symbol, key)) as Read,
		scheduleFlush: () => queueMicrotask(() => flush(state)),
	})
	for (const [symbol, ...rest] of hydrate)
		dispatch(
			state,
			symbol as AtomSymbol<any, any> | AtomFamily<any, any, any>,
			rest,
		)
	if (state.tasks) flush(state)
	state.hydrating = false
	const store: Store = {
		peek: state.read,
		send: state.write,
		resolve: ((symbol, key) => resolve(state, symbol, key)) as Resolve,
		subscribe: ((symbol, keyOrNotify, notify) =>
			subscribe(state, symbol, keyOrNotify, notify)) as Subscribe,
	}
	return { store, state }
}

function getTasks(state: StoreState): Tasks {
	if (state.tasks) return state.tasks
	state.tasks = {
		mounts: new Set(),
		primitives: new Map(),
		effects: new Set(),
		reconciles: new Set(),
		pendingFamilyEvictions: new Set(),
	}
	if (!state.hydrating) state.scheduleFlush()
	return state.tasks
}
function getInstance<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	key?: Key,
): Instance<S> {
	if (symbol.type === 'family') {
		if (symbol.retention.type === 'transient')
			return createFreshInstance(state, symbol, key!)
		const { lookup } = symbol
		switch (lookup.type) {
			case 'hash': {
				const storage = getFamilyStorage(state, symbol, () => ({
					type: 'hash',
					map: new Map(),
				}))
				isoAssert(storage.type === 'hash')
				const { map } = storage
				const hashedKey = lookup.hash(key!)
				return (
					map.get(hashedKey) ??
					createFamilyInstance(state, symbol, key!, (instance) => {
						map.set(hashedKey, instance)
						return { type: 'hash', map, hashedKey }
					})
				)
			}
			case 'eq': {
				const storage = getFamilyStorage(state, symbol, () => ({
					type: 'eq',
					pairs: [],
				}))
				isoAssert(storage.type === 'eq')
				const { pairs } = storage
				return (
					pairs.find(([k]) => lookup.eq(k, key!))?.[1] ??
					createFamilyInstance(state, symbol, key!, (instance) => {
						pairs.push([key!, instance])
						return { type: 'eq', pairs }
					})
				)
			}
			default:
				return exhaustive(lookup)
		}
	}
	let res = state.instances.get(symbol) as Instance<S> | undefined
	if (res === undefined) {
		res = createInstance(state, symbol)
		state.instances.set(symbol, res)
	}
	return res
}
function getFamilyStorage<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args>,
	init: () => FamilyStorage<S, Key>,
): FamilyStorage<S, Key> {
	let storage = state.families.get(symbol) as FamilyStorage<S, Key> | undefined
	if (storage === undefined) {
		storage = init()
		state.families.set(symbol, storage)
	}
	return storage
}
function createFamilyInstance<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args>,
	key: Key,
	register: (instance: Instance<S>) => FamilySlot,
): Instance<S> {
	const instance = createFreshInstance(state, symbol, key)
	const slot = register(instance)
	const { retention } = symbol
	isoAssert(retention.type !== 'transient')
	switch (retention.type) {
		case 'immediate':
		case 'timed':
			instance.familyEntry = { ...slot, retention }
			queueEviction(state, instance)
			break
		case 'permanent':
			break
		default:
			return exhaustive(retention)
	}
	return instance
}
function createFreshInstance<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args>,
	key: Key,
): Instance<S> {
	const created = symbol.create(key)
	isoAssert(
		!state.instances.has(created),
		'atomFamily create must return a fresh symbol on every call',
	)
	const instance = createInstance(state, created)
	state.instances.set(created, instance)
	return instance
}
function createInstance<S, Args extends unknown[]>(
	state: StoreState,
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
function queueMount(state: StoreState, instance: Instance<any>) {
	;(state.phase.mounts ?? getTasks(state).mounts).add(instance)
}
function queueEffect<S>(state: StoreState, instance: Instance<S>) {
	if (!instance.symbol.effect) return
	;(state.phase.effects ?? getTasks(state).effects).add(instance)
}
function queueReconcile<S>(state: StoreState, instance: Instance<S>) {
	if (instance.symbol.type !== 'derived') return
	;(state.phase.reconciles ?? getTasks(state).reconciles).add(instance)
}
function queueEviction(state: StoreState, instance: Instance<any>) {
	getTasks(state).pendingFamilyEvictions.add(instance)
}
function pendingWrites(state: StoreState, write: true): Map<Instance<any>, any>
function pendingWrites(
	state: StoreState,
	write?: false,
): Map<Instance<any>, any> | undefined
function pendingWrites(state: StoreState, write = false) {
	return (
		state.phase.mountWrites ??
		(write ? getTasks(state).primitives : state.tasks?.primitives)
	)
}
function invalidate<S>(
	state: StoreState,
	instance: Instance<S>,
	affected: Set<Instance<any>>,
) {
	if (affected.has(instance)) return
	affected.add(instance)
	if (instance.symbol.type === 'derived') instance.freshness = { type: 'dirty' }
	if (instance.mountCount > 0) {
		queueReconcile(state, instance)
		queueEffect(state, instance)
	}
	for (const sub of instance.mountedSubs) invalidate(state, sub, affected)
}
/**
 * Delivers to a snapshot of subscription registrations. A registration
 * removed or replaced before its turn is skipped; one created during
 * delivery (including a re-subscription by the same callback) waits for a
 * later notification.
 */
function notify(state: StoreState, roots: Iterable<Instance<any>>) {
	const affected = new Set<Instance<any>>()
	for (const root of roots) invalidate(state, root, affected)
	const deliveries: Delivery[] = []
	for (const instance of affected)
		for (const [callback, registration] of instance.subscriptions)
			deliveries.push({ instance, callback, registration })
	for (const { instance, callback, registration } of deliveries)
		if (instance.subscriptions.get(callback) === registration) callback()
}
function cancelEviction<S>(state: StoreState, instance: Instance<S>) {
	state.tasks?.pendingFamilyEvictions.delete(instance)
	state.phase.familyEvictions?.delete(instance)
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
function retain<S>(state: StoreState, instance: Instance<S>) {
	if (instance.mountCount === 0) {
		cancelEviction(state, instance)
		peekInstance(state, instance)
	}
	if (instance.mountCount++ > 0) return
	syncMountedDeps(state, instance)
	if (instance.mountCount === 0) return
	queueMount(state, instance)
	queueEffect(state, instance)
}
function mount<S>(state: StoreState, instance: Instance<S>) {
	if (instance.mountCount === 0 || instance.mountLifecycle) return
	const lifecycle: MountLifecycle = {}
	instance.mountLifecycle = lifecycle
	const cleanup = instance.symbol.onMount?.(state.read, state.write)
	if (cleanup) {
		if (instance.mountLifecycle === lifecycle) lifecycle.cleanup = cleanup
		else cleanup()
	}
}
function release<S>(state: StoreState, instance: Instance<S>) {
	if (--instance.mountCount > 0) {
		releaseUnowned(state, instance)
		return
	}
	const mountedDeps = detachMountedDeps(state, instance)
	teardown(state, instance)
	if (instance.familyEntry) queueEviction(state, instance)
	for (const dep of mountedDeps) release(state, dep)
}
function syncMountedDeps<S>(state: StoreState, instance: Instance<S>) {
	for (const dep of instance.depVersions.keys()) {
		if (instance.mountCount === 0) return
		link(state, instance, dep)
	}
	// Releasing a dependency can run user cleanup that changes this graph.
	for (const dep of Array.from(instance.mountedDeps)) {
		if (instance.mountCount === 0) return
		if (instance.depVersions.has(dep)) continue
		unlink(state, instance, dep)
	}
}
/**
 * Swaps out the mounted dependency set and clears the reverse links. It
 * must run before any user callback can change dependencies or remount.
 */
function detachMountedDeps<S>(state: StoreState, instance: Instance<S>) {
	const mountedDeps = instance.mountedDeps
	instance.mountedDeps = new Set()
	for (const dep of mountedDeps) dep.mountedSubs.delete(instance)
	return mountedDeps
}
function link<S>(state: StoreState, instance: Instance<S>, dep: Instance<any>) {
	if (instance.mountedDeps.has(dep)) return
	instance.mountedDeps.add(dep)
	dep.mountedSubs.add(instance)
	retain(state, dep)
}
function unlink<S>(
	state: StoreState,
	instance: Instance<S>,
	dep: Instance<any>,
) {
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
	if (owners.size === 0) release(state, dep)
	else {
		const deferred: DeferredRelease = { dependency: dep, owners }
		dep.deferredOwners.add(deferred)
		for (const owner of owners) owner.deferredReleases.add(deferred)
	}
}
function releaseUnowned(state: StoreState, instance: Instance<any>) {
	const component = unownedComponent(instance)
	if (!component) return
	const order = getCleanupOrder(component)
	for (let index = order.length - 1; index >= 0; index--) {
		const consumer = order[index]!
		if (consumer.mountCount === 0 || !unownedComponent(consumer)) continue
		teardown(state, consumer)
		if (consumer.mountCount > 0) {
			queueMount(state, consumer)
			queueEffect(state, consumer)
		}
	}
}
function teardown(state: StoreState, instance: Instance<any>) {
	const effectLifecycle = instance.effectLifecycle
	const mountLifecycle = instance.mountLifecycle
	instance.effectLifecycle = undefined
	instance.mountLifecycle = undefined
	if (effectLifecycle) cleanupEffect(state, effectLifecycle, mountLifecycle)
	else mountLifecycle?.cleanup?.()
}
function cleanupEffect(
	state: StoreState,
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
			release(state, deferred.dependency)
		}
	}
	lifecycle.dependencies.clear()
	lifecycle.cleaning = false
}
function runEffect<S>(
	state: StoreState,
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
	const cleanup = effect(next, last, state.read, state.write)
	if (cleanup) {
		if (instance.effectLifecycle === lifecycle) lifecycle.cleanup = cleanup
		else cleanup()
	}
}
function flush(state: StoreState) {
	isoAssert(state.tasks, 'unexpected call to flush')
	const { mounts, primitives, effects, reconciles, pendingFamilyEvictions } =
		state.tasks
	const mountWrites = new Map<Instance<any>, any>()
	state.tasks = undefined
	state.phase.mounts = mounts
	state.phase.effects = effects
	state.phase.reconciles = reconciles
	state.phase.familyEvictions = pendingFamilyEvictions
	settle(state, primitives, mounts, reconciles, mountWrites)
	const transitions = collectTransitions(state, effects)
	runCleanups(state, transitions)
	runTransitions(state, transitions)
	scheduleEvictions(state, pendingFamilyEvictions)
}
function applyUpdates(state: StoreState, pending: Map<Instance<any>, any>) {
	while (pending.size > 0) {
		const updates = [...pending]
		pending.clear()
		const changed: Instance<any>[] = []
		for (const [instance, next] of updates)
			if (!Object.is(next, instance.value)) {
				instance.value = next
				publishChange(state, instance)
				changed.push(instance)
			}
		notify(state, changed)
	}
}
function settleMount(
	state: StoreState,
	instance: Instance<any>,
	mounts: Set<Instance<any>>,
	mountWrites: Map<Instance<any>, any>,
) {
	if (instance.mountCount === 0 || instance.mountLifecycle) {
		mounts.delete(instance)
		return
	}
	peekInstance(state, instance)
	for (const dep of instance.depVersions.keys())
		settleMount(state, dep, mounts, mountWrites)
	mounts.delete(instance)
	state.phase.mountWrites = mountWrites
	mount(state, instance)
	state.phase.mountWrites = undefined
	// Mount writes must settle before consumers mount or effects run.
	applyUpdates(state, mountWrites)
}
function reconcile(
	state: StoreState,
	instance: Instance<any>,
	reconciles: Set<Instance<any>>,
) {
	if (!reconciles.delete(instance)) return
	for (const sub of Array.from(instance.mountedSubs))
		reconcile(state, sub, reconciles)
	if (instance.mountCount > 0) peekInstance(state, instance)
}
function settle(
	state: StoreState,
	primitives: Map<Instance<any>, any>,
	mounts: Set<Instance<any>>,
	reconciles: Set<Instance<any>>,
	mountWrites: Map<Instance<any>, any>,
) {
	applyUpdates(state, primitives)
	do {
		applyUpdates(state, mountWrites)
		for (const instance of reconciles) reconcile(state, instance, reconciles)
		for (const instance of mounts)
			settleMount(state, instance, mounts, mountWrites)
	} while (mountWrites.size > 0 || mounts.size > 0 || reconciles.size > 0)
	state.phase.mounts = undefined
	state.phase.reconciles = undefined
}
function collectTransitions(
	state: StoreState,
	effects: Set<Instance<any>>,
): Transition[] {
	const visited = new Set<Instance<any>>()
	const transitions: Transition[] = []
	const collect = (instance: Instance<any>) => {
		if (visited.has(instance) || instance.mountCount === 0) return
		visited.add(instance)
		const next = peekInstance(state, instance)
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
	state.phase.effects = undefined
	return transitions
}
function runCleanups(state: StoreState, transitions: Transition[]) {
	const cleanupOrder = getCleanupOrder(
		transitions.map(({ instance }) => instance),
	)
	// Release consumers before the resources provided by their dependencies.
	for (let index = cleanupOrder.length - 1; index >= 0; index--) {
		const instance = cleanupOrder[index]!
		if (instance.mountCount === 0) continue
		const lifecycle = instance.effectLifecycle
		if (lifecycle) cleanupEffect(state, lifecycle)
	}
}
function runTransitions(state: StoreState, transitions: Transition[]) {
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
			runEffect(state, instance, effect, next, previous?.value)
}
function scheduleEvictions(
	state: StoreState,
	pendingFamilyEvictions: Set<Instance<any>>,
) {
	for (const instance of pendingFamilyEvictions) {
		if (instance.mountCount > 0) continue
		const { familyEntry } = instance
		isoAssert(familyEntry)
		const { retention } = familyEntry
		switch (retention.type) {
			case 'immediate':
				evict(state, instance)
				break
			case 'timed':
				isoAssert(instance.familyRemovalTimeout === undefined)
				instance.familyRemovalTimeout = setTimeout(() => {
					instance.familyRemovalTimeout = undefined
					isoAssert(instance.mountCount === 0)
					evict(state, instance)
				}, retention.ms)
				break
			default:
				exhaustive(retention)
		}
	}
	state.phase.familyEvictions = undefined
}
function evict<S>(state: StoreState, instance: Instance<S>) {
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
	publishChange(state, instance)
	instance.depVersions.clear()
	if (instance.symbol.type === 'derived') instance.freshness = { type: 'dirty' }
}
function peekInstance<S>(state: StoreState, instance: Instance<S>) {
	isoAssert(instance.freshness.type !== 'evaluating', 'cyclic atom dependency')
	const { symbol } = instance
	if (symbol.type === 'derived') revalidateUnmounted(state, instance)
	if (instance.freshness.type === 'dirty') {
		isoAssert(symbol.type === 'derived')
		instance.freshness = { type: 'evaluating' }
		instance.depVersions = new Map()
		const read = (<T, Key, Args extends unknown[]>(
			target: AtomFamily<T, Key, Args> | AtomSymbol<T, Args>,
			key?: Key,
		) => {
			const dep = getInstance(state, target, key)
			const value = peekInstance(state, dep)
			instance.depVersions.set(dep, dep.version)
			return value
		}) as Read
		const previous = instance.value
		const next = symbol.getter(read)
		instance.value = next
		if (!Object.is(next, previous)) advanceDerivedVersion(state, instance)
		instance.freshness = { type: 'clean', validatedAt: state.epoch }
		if (instance.mountCount > 0) syncMountedDeps(state, instance)
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
function publishChange<S>(state: StoreState, instance: Instance<S>) {
	instance.version++
	state.epoch++
}
function advanceDerivedVersion<S>(state: StoreState, instance: Instance<S>) {
	instance.version++
}
/**
 * Whether the instance is mounted or already validated at the current
 * epoch. It must be re-checked after `depsAreCurrent`, because nested
 * peeks can mount or revalidate the instance.
 */
function isFresh<S>(state: StoreState, instance: Instance<S>) {
	return (
		instance.mountCount > 0 ||
		(instance.freshness.type === 'clean' &&
			instance.freshness.validatedAt === state.epoch)
	)
}
function revalidateUnmounted<S>(state: StoreState, instance: Instance<S>) {
	if (instance.freshness.type === 'dirty' || isFresh(state, instance)) return
	const current = depsAreCurrent(state, instance)
	if (isFresh(state, instance)) return
	if (current) instance.freshness = { type: 'clean', validatedAt: state.epoch }
	else instance.freshness = { type: 'dirty' }
}
function depsAreCurrent<S>(state: StoreState, instance: Instance<S>) {
	state.validations++
	for (const [dep, version] of instance.depVersions) {
		if (dep.version !== version) return false
		peekInstance(state, dep)
		if (dep.version !== version) return false
	}
	return true
}
/** Setters read the pending state; public reads keep the committed snapshot. */
function readPending<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	key?: Key,
): S {
	const instance = getInstance(state, symbol, key)
	const pending = pendingWrites(state)
	if (!pending?.size) return peekInstance(state, instance)
	if (instance.symbol.type === 'primitive')
		return pending.has(instance)
			? pending.get(instance)
			: peekInstance(state, instance)
	isoAssert(!state.pendingEvaluations.has(instance), 'cyclic atom dependency')
	state.pendingEvaluations.add(instance)
	const value = instance.symbol.getter(state.readPending)
	state.pendingEvaluations.delete(instance)
	return value
}
function sendInstance<S>(
	state: StoreState,
	instance: Instance<S>,
	args: readonly unknown[],
) {
	const { symbol } = instance
	if (symbol.type === 'primitive' || symbol.getter !== noread)
		cancelEviction(state, instance)
	switch (symbol.type) {
		case 'primitive': {
			const event = args[0]
			const primitives = pendingWrites(state, true)
			const next = isFunction(event)
				? event(readPending(state, symbol))
				: isReset(event)
					? fromInit(symbol.getter)
					: event
			primitives.set(instance, next)
			return
		}
		case 'derived': {
			symbol.setter(state.readPending, state.write, ...args)
			return
		}
		default:
			return exhaustive(symbol)
	}
}
function dispatch(
	state: StoreState,
	symbol: AtomFamily<any, any, any> | AtomSymbol<any, any>,
	rest: readonly unknown[],
) {
	const key = symbol.type === 'family' ? rest[0] : undefined
	const args = symbol.type === 'family' ? rest.slice(1) : rest
	sendInstance(state, getInstance(state, symbol, key), args)
}
function subscribeInstance<S>(
	state: StoreState,
	instance: Instance<S>,
	notify: () => void,
) {
	let registration = instance.subscriptions.get(notify)
	if (!registration) {
		registration = { references: 0 }
		instance.subscriptions.set(notify, registration)
	}
	registration.references++
	retain(state, instance)
	let active = true
	return () => {
		if (!active) return
		active = false
		if (--registration.references === 0) instance.subscriptions.delete(notify)
		release(state, instance)
	}
}
function resolve<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	key?: Key,
): ResolvedAtom<S, Args> {
	const instance = getInstance(state, symbol, key)
	if (instance.handle) return instance.handle
	if (symbol.type !== 'family' || symbol.retention.type === 'transient') {
		return (instance.handle = {
			peek: () => peekInstance(state, instance),
			send: (...args) => sendInstance(state, instance, args),
			subscribe: (notify) => subscribeInstance(state, instance, notify),
		})
	}
	return (instance.handle = {
		peek: () => peekInstance(state, getInstance(state, symbol, key)),
		send: (...args) =>
			sendInstance(state, getInstance(state, symbol, key), args),
		subscribe: (notify) =>
			subscribeInstance(state, getInstance(state, symbol, key), notify),
	})
}

function subscribe<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	keyOrNotify: Key | (() => void),
	notify?: () => void,
): () => void {
	const instance = getInstance(state, symbol, keyOrNotify as Key)
	const callback =
		symbol.type === 'family' ? notify! : (keyOrNotify as () => void)
	return subscribeInstance(state, instance, callback)
}
