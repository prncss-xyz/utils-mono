type Read = <Value>(symbol: ScopeLike<Value>) => Value
type Getter<Value> = (read: Read) => Value

let nextIndex = 0

export type PrimaryScopeSymbol<Value> = Readonly<{
	type: 'scope'
	index: number
	onMount: OnMount<Value> | undefined
	value?: Value
}>

export function corePrimaryScope<Value>(
	onMount?: OnMount<Value>,
): PrimaryScopeSymbol<Value> {
	return {
		type: 'scope',
		index: nextIndex++,
		onMount,
	}
}

export type OnMount<Value> = (value: Value) => void | (() => void)

type ScopedSymbol<Value> = Readonly<{
	type: 'scoped'
	index: number
	onMount: OnMount<Value> | undefined
	getter: Getter<Value>
	value?: Value
}>

export type ScopeLike<Value> = PrimaryScopeSymbol<Value> | ScopedSymbol<Value>

export function derivedScope<Value>(
	getter: Getter<Value>,
	onMount?: OnMount<Value>,
): ScopedSymbol<Value> {
	return {
		type: 'scoped',
		index: nextIndex++,
		onMount,
		getter,
	}
}

type ScopeEntry = Readonly<{
	symbol: PrimaryScopeSymbol<any>
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
	private constructor(scopeValues: Map<PrimaryScopeSymbol<any>, any>) {
		this.scopeValues = scopeValues
	}
	static init() {
		return new ScopeContext(new Map())
	}
	childScope<T>(symbol: PrimaryScopeSymbol<T>, value: T) {
		const scopeValues = new Map<PrimaryScopeSymbol<any>, any>(this.scopeValues)
		scopeValues.set(symbol, value)
		return new ScopeContext(scopeValues)
	}
	resolveScope<T>(symbol: PrimaryScopeSymbol<T>): T {
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
	private flush() {
		if (!this.tasks) throw new Error('unexpected call to flush')
		const tasks = this.tasks
		this.tasks = undefined
		for (const instance of tasks.mount) {
			if (instance.count > 0)
				instance.cleanup = instance.symbol.onMount?.(instance.value)
		}
		for (const instance of tasks.unmount) {
			if (instance.count === 0) {
				instance.cleanup?.()
				// TODO: remove entry
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
			for (const { symbol: s, value } of entry.scopes)
				if (!Object.is(context.resolveScope(s), value)) continue outer
			return entry
		}
		const scopes: ScopeEntry[] = []
		const subscribers: ScopeInstance<any>[] = []
		let value: Value
		if (symbol.type === 'scope') {
			value = context.resolveScope(symbol)
			scopes.push({ symbol, value })
		} else {
			value = symbol.getter((s) => {
				const instance = this.resolve(context, s)
				if (s.type === 'scope')
					scopes.push({ symbol: s, value: instance.value })
				subscribers.push(instance)
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
			subscriber.dependents.push(entry)
			for (const scope of subscriber.scopes) scopes.push(scope)
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
