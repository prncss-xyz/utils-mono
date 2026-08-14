import { type AtomInstance } from './atomInstance'
import {
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

type Row<Value, Hash> = {
	dependencies: Dependency[]
	instance: PrimitiveInstance<Value>
	hash: Hash
}

type Lookup<Value, Hash> = Row<Value, Hash>[]

function createLookup<Value, Hash>(): Lookup<Value, Hash> {
	return []
}

export function primitive<Value>(
	cb: Value | ((hash: void, read: Read) => Value),
): Atom<Value, void, [SetStateWithReset<Value>], void>
export function primitive<Value>(
	cb: Value | ((hash: string, read: Read) => Value),
): Atom<Value, string, [SetStateWithReset<Value>], void>
export function primitive<Value, Hash>(
	cb: Value | ((hash: Hash, read: Read) => Value),
) {
	const atom = {
		instance(store: Store, hash: Hash): PrimitiveInstance<Value> {
			if (!isFunction(cb)) {
				if (hash !== undefined)
					throw new Error('value primitive atom cannot have an hash')
				return store.cached(atom, cb, primitiveInstance)
			}
			const lookup = store.cached(atom, undefined, createLookup<Value, Hash>)
			return scopedInstance(lookup, cb, store, hash)
		},
	}
	return atom
}

function scopedInstance<Value, Hash>(
	lookup: Lookup<Value, Hash>,
	cb: (hash: Hash, read: Read) => Value,
	store: Store,
	hash: Hash,
) {
	outer: for (const row of lookup) {
		if (row.hash !== hash) continue outer
		for (const item of row.dependencies) {
			if (!Object.is(item.instance.peek(), item.value)) continue outer
		}
		return row.instance
	}
	const dependencies: Dependency[] = []
	const read: Read = (a, h) => {
		const instance = a.instance(store, h)
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
