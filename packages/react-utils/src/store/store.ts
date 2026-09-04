import {
	exhaustive,
	fromInit,
	id,
	isFunction,
	isReset,
	type SetStateWithReset,
} from '../functions'
import { call, isMounted, sortedPush, sortedRemove } from './utils'

export const TRANSIENT = -1

let nextIndex = 0

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
	effectCleanup: (() => void) | undefined
	deps: Instance<any>[]
	subs: Instance<any>[]
	subscriptions: Set<() => void>
	mounted: boolean
}

type CoreSymbol<S, E> = {
	index: number
	effect?: Effect<S, E>
}

type PrimitiveSymbol<S, E> = CoreSymbol<S, E> & {
	type: 'primitive'
	getter: (() => S) | S
	readonly event?: E
}

type DerivedSymbol<S, E> = CoreSymbol<S, E> & {
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
type Getter<S> = (read: Read) => S
type Setter<E> = (read: Read, write: Write, e: E) => void
export type Effect<S, E> = (
	next: S | undefined,
	last: S | undefined,
	selfSend: (event: E) => void,
) => void | (() => void)

export function primitive<S>(
	getter: S | (() => S),
	effect?: Effect<NoInfer<S>, SetStateWithReset<S>>,
): AtomSymbol<S, SetStateWithReset<S>> {
	return {
		type: 'primitive' as const,
		getter,
		effect,
		index: nextIndex++,
	}
}

export function derived<S, E>(
	getter: Getter<S>,
	setter: Setter<E>,
	effect?: Effect<NoInfer<S>, E>,
): AtomSymbol<S, E> {
	return {
		type: 'derived' as const,
		getter,
		setter,
		effect,
		index: nextIndex++,
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

type Tasks = {
	primitives: Map<Instance<any>, any>
	effects: Set<Instance<any>>
	unmountedFamilyEntries: Set<Instance<any>>
}

class Store {
	private contents = new WeakMap<any, any>()
	private tasks: Tasks | undefined = undefined
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
			effectCleanup: undefined,
			deps: [],
			subs: [],
			subscriptions: new Set(),
			mounted: false,
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
		if (instance.mounted) this.enqueueEffect(instance)
		for (const sub of instance.subs) this.notify(sub)
		instance.subscriptions.forEach(call)
	}
	private isMounted<S>(instance: Instance<S>) {
		return instance.subscriptions.size > 0 || instance.deps.some(isMounted)
	}
	private updateMounted<S>(instance: Instance<S>) {
		const mounted = this.isMounted(instance)
		if (mounted === instance.mounted) return
		instance.mounted = mounted
		if (mounted) {
			for (const [timeout, familyEntry] of instance.familyRemovalTimeouts) {
				clearTimeout(timeout)
				instance.familyEntries.push(familyEntry)
			}
			instance.familyRemovalTimeouts.clear()
			this.enqueueEffect(instance)
		} else {
			const symbol = instance.symbol as AtomSymbol<S, unknown>
			if (symbol.effect)
				this.runEffect(symbol, instance, symbol.effect, undefined)
			if (instance.familyEntries.length > 0)
				this.getTasks().unmountedFamilyEntries.add(instance)
		}
		for (const sub of instance.subs) this.updateMounted(sub)
	}
	private runEffect<S, E>(
		symbol: AtomSymbol<S, E>,
		instance: Instance<S>,
		effect: Effect<S, E> | undefined,
		next: S | undefined,
	) {
		const last = instance.effectValue
		instance.effectValue = next
		instance.effectCleanup?.()
		instance.effectCleanup =
			effect?.(next, last, (event) => this.send(symbol, event)) || undefined
	}
	private transitionEffect<S, E>(instance: Instance<S>) {
		const symbol: AtomSymbol<S, E> = instance.symbol
		const next = this.peekInstance(instance)
		if (!instance.mounted) return
		if (Object.is(next, instance.effectValue)) return
		this.runEffect(symbol, instance, symbol.effect, next)
	}
	private flush() {
		if (!this.tasks) return
		const { primitives, effects, unmountedFamilyEntries } = this.tasks
		this.tasks = undefined
		this.flushingEffects = effects
		// oxlint-disable-next-line prefer-const
		for (let [instance, next] of primitives)
			if (!Object.is(next, instance.value)) {
				instance.value = next
				this.notify(instance)
			}
		this.flushingEffects = undefined
		for (const instance of effects)
			if (instance.mounted) this.transitionEffect(instance)
		for (const instance of unmountedFamilyEntries) {
			if (instance.mounted) continue
			for (const familyEntry of instance.familyEntries) {
				const { entry, hashedKey, TTL } = familyEntry
				if (TTL === Infinity) continue
				if (TTL === 0) {
					if (entry.get(hashedKey) === instance) entry.delete(hashedKey)
					continue
				}
				const timeout = setTimeout(() => {
					instance.familyRemovalTimeouts.delete(timeout)
					if (!instance.mounted && entry.get(hashedKey) === instance)
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
					for (const dep of instance.deps) sortedRemove(dep.subs, instance)
					instance.deps = []
					const read = (<T, Key, Event>(
						target: AtomFamily<T, Key, Event> | AtomSymbol<T, Event>,
						key?: Key,
					) => {
						const dep = this.getInstance(target, key)
						sortedPush(instance.deps, dep)
						sortedPush(dep.subs, instance)
						return this.peekInstance(dep)
					}) as Read
					instance.value = symbol.getter(read)
					this.updateMounted(instance)
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
				const { primitives } = this.getTasks()
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
		instance.subscriptions.add(notify)
		this.updateMounted(instance)
		return () => {
			instance.subscriptions.delete(notify)
			this.updateMounted(instance)
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

export function createStore(hydrate?: Hydrate) {
	return new Store(hydrate)
}
