import { isoAssert } from '../functions'
import { sortedPush } from '../utils'

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

type ScopeEntry = Readonly<{
	symbol: PrimitiveScopeSymbol<any>
	value: any
}>

type ScopeInstance<Value> = {
	readonly type: 'scopeInstance'
	readonly value: Value
	count: number
	readonly scopes: ScopeEntry[]
	readonly subscribers: ScopeInstance<any>[]
	readonly dependents: ScopeInstance<any>[]
	readonly symbol: ScopeLike<Value>
	cleanup: void | (() => void)
}

type ScopeStep = {
	readonly type: 'step'
	readonly symbol: PrimitiveScopeSymbol<any>
	readonly values: Map<any, StoredScope>
}

type StoredScope = ScopeStep | ScopeInstance<any>

function buildScopeSteps(
	instance: ScopeInstance<any>,
	depth: number,
): ScopeStep {
	const scope = instance.scopes[depth]
	isoAssert(scope, 'scope lattice invariant: scope path is missing')
	const step: ScopeStep = {
		type: 'step',
		symbol: scope.symbol,
		values: new Map(),
	}
	const isTerminal = depth === instance.scopes.length - 1
	const child = isTerminal ? instance : buildScopeSteps(instance, depth + 1)
	step.values.set(scope.value, child)
	return step
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
	private readonly contents = new Map<ScopeLike<any>, StoredScope>()
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
	private findInstance(
		context: ScopeContext,
		root: StoredScope | undefined,
	): ScopeInstance<any> | undefined {
		let stored = root
		while (stored?.type === 'step') {
			const value = context.resolveScope(stored.symbol)
			stored = stored.values.get(value)
		}
		return stored
	}
	private insertInstance(instance: ScopeInstance<any>) {
		const root = this.contents.get(instance.symbol)
		if (!root) {
			const newRoot =
				instance.scopes.length === 0 ? instance : buildScopeSteps(instance, 0)
			this.contents.set(instance.symbol, newRoot)
			return
		}
		isoAssert(
			instance.scopes.length > 0 && root.type === 'step',
			'scope lattice invariant: scope instance prefix collision',
		)
		let step = root
		for (let depth = 0; depth < instance.scopes.length; depth++) {
			const scope = instance.scopes[depth]
			isoAssert(scope, 'scope lattice invariant: scope path is missing')
			isoAssert(
				step.symbol === scope.symbol,
				'scope lattice invariant: conflicting scope step symbol',
			)
			const key = scope.value
			const stored = step.values.get(key)
			const isTerminal = depth === instance.scopes.length - 1
			if (!stored) {
				const child = isTerminal
					? instance
					: buildScopeSteps(instance, depth + 1)
				step.values.set(key, child)
				return
			}
			isoAssert(
				!isTerminal && stored.type === 'step',
				'scope lattice invariant: scope instance prefix collision',
			)
			step = stored
		}
		isoAssert(false, 'scope lattice invariant: insertion did not terminate')
	}
	private removeStoredInstance(instance: ScopeInstance<any>) {
		const root = this.contents.get(instance.symbol)
		isoAssert(root, 'scope instance root is missing')
		if (root.type === 'scopeInstance') {
			isoAssert(root === instance, 'scope instance root identity is mismatched')
			this.contents.delete(instance.symbol)
			return
		}
		isoAssert(
			instance.scopes.length > 0,
			'scope lattice invariant: scope path is missing',
		)
		const path: { step: ScopeStep; key: any }[] = []
		let stored: StoredScope = root
		for (let depth = 0; depth < instance.scopes.length; depth++) {
			const scope = instance.scopes[depth]
			isoAssert(scope, 'scope lattice invariant: scope path is missing')
			isoAssert(
				stored.type === 'step' && stored.symbol === scope.symbol,
				'scope lattice invariant: removal path symbol is mismatched',
			)
			const key = scope.value
			path.push({ step: stored, key })
			const child = stored.values.get(key)
			isoAssert(child, 'scope lattice invariant: removal path is missing')
			stored = child
		}
		isoAssert(
			stored === instance,
			'scope lattice invariant: removal identity is mismatched',
		)
		const terminal = path.at(-1)
		isoAssert(terminal, 'scope lattice invariant: removal path is empty')
		terminal.step.values.delete(terminal.key)
		for (let index = path.length - 2; index >= 0; index--) {
			const parent = path[index]
			const child = path[index + 1]
			isoAssert(
				parent && child,
				'scope lattice invariant: removal path is invalid',
			)
			if (child.step.values.size > 0) break
			parent.step.values.delete(parent.key)
		}
		if (root.values.size === 0) this.contents.delete(instance.symbol)
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
		this.removeStoredInstance(instance)
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
		const cached = this.findInstance(context, this.contents.get(symbol))
		if (cached) return cached
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
			type: 'scopeInstance',
			value,
			count: 0,
			cleanup: undefined,
			scopes,
			subscribers,
			symbol,
			dependents: [],
		}
		for (const subscriber of subscribers)
			for (const scope of subscriber.scopes) sortedPush(scopes, scope)
		this.insertInstance(entry)
		for (const subscriber of subscribers)
			sortedPush(subscriber.dependents, entry)
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
