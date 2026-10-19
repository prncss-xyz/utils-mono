import { isoAssert } from '../functions'

type Read = <Value>(symbol: ScopeLike<Value>) => Value

/**
 * Needs to be a pure function
 */
type Getter<Value> = (read: Read) => Value

let nextIndex = 0

export type PrimitiveScopeSymbol<Value> = Readonly<{
	type: 'primitiveScope'
	index: number
	onMount: OnMount<Value> | undefined
	value?: Value
}>

export function primitiveScope<Value>(
	onMount?: OnMount<Value>,
): PrimitiveScopeSymbol<Value> {
	return {
		type: 'primitiveScope',
		index: nextIndex++,
		onMount,
	}
}

export type OnMount<Value> = (value: Value) => void | (() => void)

type DerivedScopeSymbol<Value> = Readonly<{
	type: 'derivedScope'
	index: number
	onMount: OnMount<Value> | undefined
	getter: Getter<Value>
	value?: Value
}>

export type ScopeLike<Value> =
	| PrimitiveScopeSymbol<Value>
	| DerivedScopeSymbol<Value>

export function derivedScope<Value>(
	getter: Getter<Value>,
	onMount?: OnMount<Value>,
): DerivedScopeSymbol<Value> {
	return {
		type: 'derivedScope',
		index: nextIndex++,
		onMount,
		getter,
	}
}

type ScopeInstance<Value> = {
	readonly type: 'scopeInstance'
	readonly value: Value
	count: number
	active: boolean
	readonly scopes: ReadonlyMap<PrimitiveScopeSymbol<any>, any>
	readonly subscribers: Set<ScopeInstance<any>>
	readonly dependents: Set<ScopeInstance<any>>
	readonly symbol: ScopeLike<Value>
	cleanup: void | (() => void)
}

export class ScopeContext {
	private readonly scopeValues
	private constructor(scopeValues: Map<PrimitiveScopeSymbol<any>, any>) {
		this.scopeValues = scopeValues
	}
	static init() {
		return new ScopeContext(new Map())
	}
	childScope<T>(symbol: PrimitiveScopeSymbol<T>, value: T) {
		const scopeValues = new Map<PrimitiveScopeSymbol<any>, any>(
			this.scopeValues,
		)
		scopeValues.set(symbol, value)
		return new ScopeContext(scopeValues)
	}
	matchesScope<T>(symbol: PrimitiveScopeSymbol<T>, value: T): boolean {
		if (!this.scopeValues.has(symbol)) return false
		const actual = this.scopeValues.get(symbol)
		return Object.is(actual, value)
	}
	resolveScope<T>(symbol: PrimitiveScopeSymbol<T>): T {
		if (this.scopeValues.has(symbol)) return this.scopeValues.get(symbol)
		throw new Error(`You are trying to access a scope where it is not provided`)
	}
}

export class ScopeStore {
	private readonly contents = new Map<ScopeLike<any>, ScopeInstance<any>[]>()
	private tasks:
		| {
				mount: ScopeInstance<any>[]
				unmount: ScopeInstance<any>[]
		  }
		| undefined
	private getTasks() {
		if (!this.tasks) {
			this.tasks = { mount: [], unmount: [] }
			queueMicrotask(this.flush.bind(this))
		}
		return this.tasks
	}
	private removeInstance(
		instance: ScopeInstance<any>,
		removed: Set<ScopeInstance<any>>,
	) {
		if (removed.has(instance)) return
		removed.add(instance)
		isoAssert(instance.count === 0, 'cannot remove a mounted scope instance')

		for (const dependent of [...instance.dependents])
			this.removeInstance(dependent, removed)
		for (const subscriber of instance.subscribers)
			isoAssert(
				subscriber.dependents.delete(instance),
				'scope dependency link is missing',
			)
		const candidates = this.contents.get(instance.symbol)
		isoAssert(candidates, 'scope cache entry is missing')
		const index = candidates.indexOf(instance)
		isoAssert(index !== -1, 'scope instance is missing from cache')
		candidates.splice(index, 1)
		if (candidates.length === 0) this.contents.delete(instance.symbol)
	}
	private cleanupInstance(
		instance: ScopeInstance<any>,
		pending: Set<ScopeInstance<any>>,
	) {
		if (!pending.delete(instance) || instance.count !== 0) return
		for (const dependent of instance.dependents)
			this.cleanupInstance(dependent, pending)
		if (instance.count !== 0 || !instance.active) return
		const cleanup = instance.cleanup
		instance.active = false
		instance.cleanup = undefined
		cleanup?.()
	}
	private flush() {
		isoAssert(this.tasks, 'unexpected call to flush')
		const tasks = this.tasks
		this.tasks = undefined
		for (const instance of tasks.mount) {
			if (instance.count === 0 || instance.active) continue
			// Activity is separate from cleanup: onMount may return nothing.
			instance.active = true
			instance.cleanup = instance.symbol.onMount?.(instance.value)
		}
		const pending = new Set(tasks.unmount)
		for (const instance of tasks.unmount)
			this.cleanupInstance(instance, pending)
		const removed = new Set<ScopeInstance<any>>()
		for (const instance of tasks.unmount)
			if (instance.count === 0 && instance.symbol.type === 'primitiveScope')
				this.removeInstance(instance, removed)
	}
	resolve<Value>(
		context: ScopeContext,
		symbol: ScopeLike<Value>,
	): ScopeInstance<Value> {
		const candidates = this.contents.get(symbol)
		if (candidates) {
			candidate: for (const instance of candidates) {
				for (const [symbol, value] of instance.scopes)
					if (!context.matchesScope(symbol, value)) continue candidate
				return instance
			}
		}
		const scopes = new Map<PrimitiveScopeSymbol<any>, any>()
		const subscribers = new Set<ScopeInstance<any>>()
		let value: Value
		if (symbol.type === 'primitiveScope') {
			value = context.resolveScope(symbol)
			scopes.set(symbol, value)
		} else {
			value = symbol.getter((dependency) => {
				const instance = this.resolve(context, dependency)
				for (const [symbol, value] of instance.scopes) scopes.set(symbol, value)
				subscribers.add(instance)
				return instance.value
			})
		}
		const entry: ScopeInstance<Value> = {
			type: 'scopeInstance',
			value,
			count: 0,
			active: false,
			cleanup: undefined,
			scopes,
			subscribers,
			symbol,
			dependents: new Set(),
		}
		if (candidates) candidates.push(entry)
		else this.contents.set(symbol, [entry])
		for (const subscriber of subscribers) subscriber.dependents.add(entry)
		return entry
	}
	private modifyMount<T>(instance: ScopeInstance<T>, delta: -1 | 1) {
		const mounting = instance.count === 0
		instance.count += delta
		for (const subscriber of instance.subscribers)
			this.modifyMount(subscriber, delta)
		if (mounting) this.getTasks().mount.push(instance)
		if (instance.count === 0) this.getTasks().unmount.unshift(instance)
	}
	mount<T>(instance: ScopeInstance<T>) {
		this.modifyMount(instance, 1)
		let released = false
		return () => {
			if (released) return
			released = true
			this.modifyMount(instance, -1)
		}
	}
}
