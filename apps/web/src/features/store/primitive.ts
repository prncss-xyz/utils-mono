import { noWrite, type AtomInstance } from './atomInstance'
import {
	cached,
	fromInit,
	isFunction,
	isReset,
	type Init,
	type SetStateWithReset,
} from './functions'
import type { OnMount } from './mount'
import type { Atom, Store } from './store'
import { Subscribed } from './subscribed'

type Read = <V, H, Args extends any[], R>(a: Atom<V, H, Args, R>, h: H) => V

type Dependency = {
	instance: AtomInstance<any, any, any>
	value: any
}

type Row<V> = {
	dependencies: Dependency[]
	instance: PrimitiveInstance<V>
}

type Lookup<V> = Row<V>[]

function createLookup<Value>(): Lookup<Value> {
	return []
}

function createHash<Hash, Value>() {
	return new Map<Hash, Value>()
}

export function primitive<V>(
	cb: V | ((hash: void, read: Read) => V),
): (store: Store) => PrimitiveInstance<V>
export function primitive<V>(
	cb: V | ((hash: string, read: Read) => V),
): (store: Store, hash: string) => PrimitiveInstance<V>
export function primitive<Hash, Value>(
	cb: Value | ((hash: Hash, read: Read) => Value),
) {
	const k = {}
	return (store: Store, hash: Hash): PrimitiveInstance<Value> => {
		if (!isFunction(cb)) {
			if (hash !== undefined)
				throw new Error('value primitive atom cannot have an hash')
			return store.cached(k, cb, primitiveInstance)
		}
		let lookup: Lookup<Value>
		if (hash === undefined) lookup = store.cached(k, undefined, createLookup)
		else {
			const m = store.cached(k, undefined, createHash<Hash, Value>)
			lookup = cached(m, hash, createLookup<Value>)
		}
		return dependantInstance(lookup, cb, store, hash)
	}
}

function dependantInstance<Hash, Value>(
	lookup: Lookup<Value>,
	cb: (hash: Hash, read: Read) => Value,
	store: Store,
	hash: Hash,
) {
	outer: for (const row of lookup) {
		for (const item of row.dependencies) {
			if (!Object.is(item.instance.peek(), item.value)) continue outer
		}
		return row.instance
	}
	const dependencies: Dependency[] = []
	const read: Read = (a, h) => {
		const instance = a(store, h)
		const value = instance.peek()
		dependencies.push({
			instance,
			value,
		})
		return value
	}
	const instance = primitiveInstance(cb(hash, read))
	lookup.push({
		instance,
		dependencies,
	})
	for (const dependancy of dependencies)
		dependancy.instance.subscribe(instance.notify.bind(instance))
	return instance
}

export function scope<V>() {
	const key = {}
	return (store: Store, _: void): ValueInstance<V> => {
		return store.value(key)
	}
}

export function valueInstance<V>(init: V) {
	return new ValueInstance(init)
}

export class ValueInstance<Value> extends Subscribed<Value, [x: never], void> {
	private init
	constructor(init: Value, onMount?: OnMount) {
		super(onMount)
		this.init = init
	}
	send(x: never) {
		return noWrite(x)
	}
	peek() {
		return this.init
	}
}

function primitiveInstance<V>(init: V) {
	return new PrimitiveInstance(init)
}

export class PrimitiveInstance<Value> extends Subscribed<
	Value,
	[SetStateWithReset<Value>],
	void
> {
	private init
	private pristine = true
	private value: Value = undefined as never
	constructor(init: Init<Value>, onMount?: OnMount) {
		super(onMount)
		this.init = init
	}
	send(arg: SetStateWithReset<Value>) {
		if (isReset(arg)) {
			if (this.pristine) return
			this.pristine = false
			this.notify()
			return
		}
		let nextValue: Value
		if (isFunction(arg)) {
			nextValue = arg(this.peek())
		} else {
			this.pristine = false
			nextValue = arg
		}
		if (Object.is(nextValue, this.value)) return
		this.value = nextValue
		this.notify()
	}
	peek() {
		if (this.pristine) {
			this.pristine = false
			this.value = fromInit(this.init)
		}
		return this.value
	}
}
