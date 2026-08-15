import { type AtomInstance } from './atomInstance'
import {
	fromInit,
	isFunction,
	isReset,
	type Init,
	type SetStateWithReset,
} from './functions'
import { getHash } from './hash'
import type { OnMount } from './mount'
import type { Atom, Read, Store } from './store'
import { Subscribed } from './subscribed'

type Dependency = {
	instance: AtomInstance<any, any, any>
	value: any
}

type Row<Value> = {
	dependencies: Dependency[]
	instance: PrimitiveInstance<Value>
	hash: string
}

type Lookup<Value> = Row<Value>[]

function createLookup<Value>(): Lookup<Value> {
	return []
}

export function primitive<Value>(
	cb: Value | ((hash: void, read: Read) => Value),
): Atom<Value, void, [SetStateWithReset<Value>], void>
export function primitive<Value, Key>(
	cb: (key: NonNullable<Key>, read: Read) => Value,
): Atom<Value, Key, [SetStateWithReset<Value>], void>
export function primitive<Value, Key>(
	cb: Value | ((key: Key, read: Read) => Value),
) {
	const atom = {
		instance(store: Store, key: Key): PrimitiveInstance<Value> {
			if (!isFunction(cb)) {
				if (key !== undefined)
					throw new Error('value primitive atom cannot have an hash')
				return store.cached(atom, cb, primitiveInstance)
			}
			const lookup = store.cached(atom, undefined, createLookup<Value>)
			return scopedInstance(lookup, cb, store, key)
		},
	}
	return atom
}

function scopedInstance<Value, Key>(
	lookup: Lookup<Value>,
	cb: (key: Key, read: Read) => Value,
	store: Store,
	key: Key,
) {
	const hash = getHash(key)
	outer: for (const row of lookup) {
		if (row.hash !== hash) continue outer
		for (const item of row.dependencies) {
			if (!Object.is(item.instance.peek(), item.value)) continue outer
		}
		return row.instance
	}
	const dependencies: Dependency[] = []
	const read = <V, K, Args extends any[], R>(a: Atom<V, K, Args, R>, k: K) => {
		const instance = a.instance(store, k)
		const value = instance.peek()
		dependencies.push({
			instance,
			value,
		})
		return value
	}
	const instance = primitiveInstance(cb(key, read as Read))
	lookup.push({
		instance,
		dependencies,
		hash,
	})
	for (const dependancy of dependencies)
		dependancy.instance.subscribe(instance.notify.bind(instance))
	return instance
}

function primitiveInstance<V>(init: V) {
	return new PrimitiveInstance(init)
}

class PrimitiveInstance<Value> extends Subscribed<
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
			this.pristine = true
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
