import { isoAssert } from '../functions'
import { sortedPush } from '../utils'

type Read = <Value>(symbol: ScopeLike<Value>) => Value
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

type ScopeEntry = Readonly<{
	symbol: PrimitiveScopeSymbol<any>
	value: any
}>

type ScopeInstance<Value> = {
	readonly value: Value
	count: number
	readonly scopes: ScopeEntry[]
	readonly subscribers: ScopeInstance<any>[]
	readonly dependents: ScopeInstance<any>[]
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
		removed = new Set<ScopeInstance<any>>(),
	) {
		if (removed.has(instance)) return
		removed.add(instance)
		isoAssert(instance.count === 0, 'cannot remove a mounted scope instance')

		for (const dependent of [...instance.dependents])
			this.removeInstance(dependent, removed)
		for (const subscriber of instance.subscribers) {
			const index = subscriber.dependents.indexOf(instance)
			isoAssert(index !== -1, 'scope dependency link is missing')
			subscriber.dependents.splice(index, 1)
		}

		const entries = this.contents.get(instance.symbol)
		isoAssert(entries, 'scope instance entries are missing')
		const index = entries.indexOf(instance)
		isoAssert(index !== -1, 'scope instance entry is missing')
		entries.splice(index, 1)
		if (entries.length === 0) this.contents.delete(instance.symbol)
	}
	private flush() {
		isoAssert(this.tasks, 'unexpected call to flush')
		const tasks = this.tasks
		this.tasks = undefined
		for (const instance of tasks.mount) {
			if (instance.count > 0)
				instance.cleanup = instance.symbol.onMount?.(instance.value)
		}
		for (const instance of tasks.unmount) {
			if (instance.count === 0) {
				instance.cleanup?.()
				if (instance.symbol.type === 'primitiveScope')
					this.removeInstance(instance)
			}
		}
	}
	resolve<Value>(
		context: ScopeContext,
		symbol: ScopeLike<Value>,
	): ScopeInstance<Value> {
		const entries = this.contents.get(symbol) ?? []
		this.contents.set(symbol, entries)
		outer: for (const entry of entries) {
			for (const { symbol: scope, value } of entry.scopes) {
				if (!Object.is(context.resolveScope(scope), value)) continue outer
			}
			return entry
		}
		const scopes: ScopeEntry[] = []
		const subscribers: ScopeInstance<any>[] = []
		let value: Value
		if (symbol.type === 'primitiveScope') {
			value = context.resolveScope(symbol)
			sortedPush(scopes, { symbol, value })
		} else {
			value = symbol.getter((dependency) => {
				const instance = this.resolve(context, dependency)
				if (dependency.type === 'primitiveScope') {
					sortedPush(scopes, { symbol: dependency, value: instance.value })
				}
				sortedPush(subscribers, instance)
				return instance.value
			})
		}
		const entry: ScopeInstance<Value> = {
			value,
			count: 0,
			cleanup: undefined,
			scopes,
			subscribers,
			symbol,
			dependents: [],
		}
		for (const subscriber of subscribers) {
			sortedPush(subscriber.dependents, entry)
			for (const scope of subscriber.scopes) sortedPush(scopes, scope)
		}
		entries.push(entry)
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
		return () => this.modifyMount(instance, -1)
	}
}
