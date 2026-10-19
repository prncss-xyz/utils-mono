import { isoAssert } from '../functions'

type Read = <Value>(symbol: ScopeLike<Value>) => Value
type Getter<Value> = (read: Read) => Value

export type PrimitiveScopeSymbol<Value> = Readonly<{
	type: 'primitiveScope'
	onMount: OnMount<Value> | undefined
	value?: Value
}>

export function primitiveScope<Value>(
	onMount?: OnMount<Value>,
): PrimitiveScopeSymbol<Value> {
	return {
		type: 'primitiveScope',
		onMount,
	}
}

export type OnMount<Value> = (value: Value) => void | (() => void)

type DerivedScopeSymbol<Value> = Readonly<{
	type: 'derivedScope'
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
		onMount,
		getter,
	}
}

type ScopeInstance<Value> = {
	readonly type: 'scopeInstance'
	readonly value: Value
	mountCount: number
	mounted: boolean
	readonly scopes: ReadonlyMap<PrimitiveScopeSymbol<any>, any>
	readonly deps: Set<ScopeInstance<any>>
	readonly subs: Set<ScopeInstance<any>>
	readonly symbol: ScopeLike<Value>
	mountCleanup: void | (() => void)
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
		isoAssert(
			this.scopeValues.has(symbol),
			'You are trying to access a scope where it is not provided',
		)
		return this.scopeValues.get(symbol)
	}
}

type Tasks = {
	mount: ScopeInstance<any>[]
	unmount: ScopeInstance<any>[]
	unmountStore: boolean
}

export class ScopeStore {
	private disposed = false
	private storeMountCount = 0
	private readonly contents = new Map<ScopeLike<any>, ScopeInstance<any>[]>()
	private tasks: Tasks | undefined
	private getTasks(): Tasks {
		if (this.tasks) return this.tasks
		this.tasks = { mount: [], unmount: [], unmountStore: false }
		queueMicrotask(this.flush.bind(this))
		return this.tasks
	}
	private removeInstance(
		instance: ScopeInstance<any>,
		removed: Set<ScopeInstance<any>>,
	) {
		if (removed.has(instance)) return
		removed.add(instance)
		isoAssert(
			instance.mountCount === 0,
			'cannot remove a mounted scope instance',
		)
		for (const sub of [...instance.subs]) this.removeInstance(sub, removed)
		for (const dep of instance.deps)
			isoAssert(dep.subs.delete(instance), 'scope dependency link is missing')
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
		if (instance.scopes.size === 0) return
		if (!pending.delete(instance) || instance.mountCount !== 0) return
		for (const sub of instance.subs) this.cleanupInstance(sub, pending)
		if (instance.mountCount !== 0 || !instance.mounted) return
		const cleanup = instance.mountCleanup
		instance.mounted = false
		instance.mountCleanup = undefined
		cleanup?.()
	}
	private flush() {
		if (this.disposed) return
		isoAssert(this.tasks, 'unexpected call to flush')
		const tasks = this.tasks
		this.tasks = undefined
		if (tasks.unmountStore && this.storeMountCount === 0) {
			this.disposeStore()
			return
		}
		for (const instance of tasks.mount) {
			if (instance.mountCount === 0 || instance.mounted) continue
			// Mounted state is separate from cleanup: onMount may return nothing.
			instance.mounted = true
			instance.mountCleanup = instance.symbol.onMount?.(instance.value)
		}
		const pending = new Set(tasks.unmount)
		for (const instance of tasks.unmount)
			this.cleanupInstance(instance, pending)
		const removed = new Set<ScopeInstance<any>>()
		for (const instance of tasks.unmount)
			if (
				instance.mountCount === 0 &&
				instance.symbol.type === 'primitiveScope'
			)
				this.removeInstance(instance, removed)
	}
	resolve<Value>(
		context: ScopeContext,
		symbol: ScopeLike<Value>,
	): ScopeInstance<Value> {
		isoAssert(!this.disposed, 'cannot resolve a scope in an unmounted store')
		const candidates = this.contents.get(symbol)
		if (candidates) {
			candidate: for (const instance of candidates) {
				for (const [symbol, value] of instance.scopes)
					if (!context.matchesScope(symbol, value)) continue candidate
				return instance
			}
		}
		const scopes = new Map<PrimitiveScopeSymbol<any>, any>()
		const deps = new Set<ScopeInstance<any>>()
		let value: Value
		if (symbol.type === 'primitiveScope') {
			value = context.resolveScope(symbol)
			scopes.set(symbol, value)
		} else {
			value = symbol.getter((dependency) => {
				const instance = this.resolve(context, dependency)
				for (const [symbol, value] of instance.scopes) scopes.set(symbol, value)
				deps.add(instance)
				return instance.value
			})
		}
		const entry: ScopeInstance<Value> = {
			type: 'scopeInstance',
			value,
			mountCount: 0,
			mounted: false,
			mountCleanup: undefined,
			scopes,
			deps,
			symbol,
			subs: new Set(),
		}
		if (candidates) candidates.push(entry)
		else this.contents.set(symbol, [entry])
		for (const dep of deps) dep.subs.add(entry)
		return entry
	}
	private modifyMount<T>(instance: ScopeInstance<T>, delta: -1 | 1) {
		const mounting = instance.mountCount === 0
		instance.mountCount += delta
		for (const dep of instance.deps) this.modifyMount(dep, delta)
		if (mounting) this.getTasks().mount.push(instance)
		if (instance.mountCount === 0) this.getTasks().unmount.unshift(instance)
	}
	/** Disposes the store after its last owner releases, unless remounted in the same batch. */
	mountStore() {
		isoAssert(!this.disposed, 'cannot mount an unmounted store')
		this.storeMountCount++
		let released = false
		return () => {
			if (released) return
			released = true
			if (--this.storeMountCount === 0) this.getTasks().unmountStore = true
		}
	}
	private disposeStore() {
		if (this.disposed) return
		this.disposed = true
		this.tasks = undefined
		const visited = new Set<ScopeInstance<any>>()
		const cleanup = (instance: ScopeInstance<any>) => {
			if (visited.has(instance)) return
			visited.add(instance)
			for (const sub of instance.subs) cleanup(sub)
			const effectCleanup = instance.mountCleanup
			instance.mounted = false
			instance.mountCleanup = undefined
			instance.subs.clear()
			effectCleanup?.()
		}
		for (const instances of this.contents.values())
			for (const instance of instances) cleanup(instance)
		this.contents.clear()
	}
	mount<T>(instance: ScopeInstance<T>) {
		isoAssert(!this.disposed, 'cannot mount a scope in an unmounted store')
		this.modifyMount(instance, 1)
		let released = false
		return () => {
			if (released || this.disposed) return
			released = true
			this.modifyMount(instance, -1)
		}
	}
}
