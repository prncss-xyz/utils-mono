import {
	cached,
	fromInit,
	isFunction,
	isReset,
	type Init,
	type SetStateWithReset,
} from './functions'
import type { OnMount } from './mount'
import type { Store } from './store'
// import type { Atom } from './store'
import { Subscribed } from './subscribed'

// type Read = <V, H>(a: Atom<V, H>, h: H) => V
//

export function primitive<Hash, V>(cb: V | ((k: Hash) => V)) {
	const k = {}
	return (store: Store, hash: Hash): PrimitiveInstance<V> => {
		if (hash === undefined) {
			return cached(store, k, () => {
				if (!isFunction(cb)) return primitiveInstance(cb)
				return primitiveInstance(cb(hash))
			})
		}
		if (!isFunction(cb)) throw new Error('function expected')
		const m = cached(store, k, () => new Map<Hash, V>())
		return cached(m, hash, (h) => primitiveInstance(cb(h)))
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
