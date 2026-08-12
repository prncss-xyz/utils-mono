import {
	fromInit,
	isFunction,
	isReset,
	type Init,
	type SetStateWithReset,
} from './functions'
import type { OnMount } from './mount'
import type { Atom } from './store'
import { Subscribed } from './subscribed'

export type ValueStore<Value> = Subscribed<Value, [Value], void>

export function primitive<V, H = void>(init: V | ((h: H) => V)): Atom<V, H> {
	return new Primitive<V, H>(init)
}

export class Primitive<Value, Hash> implements Atom<Value, Hash> {
	readonly init
	constructor(init: Value | ((h: Hash) => Value)) {
		this.init = init
	}
	create(h: Hash) {
		if (h === undefined)
			return new PrimitiveInstance(
				isFunction(this.init) ? this.init(h) : this.init,
			)
		return new Map<string, PrimitiveInstance<Value>>()
	}
	pick(a: any, h: Hash) {
		if (h === undefined) return a
		if (!isFunction(this.init)) throw new Error('function expected')
		let res = a.get(h)
		if (!res) {
			res = new PrimitiveInstance(this.init(h))
			a.set(h, res)
		}
		return res
	}
}

export class PrimitiveInstance<Value>
	extends Subscribed<Value, [SetStateWithReset<Value>], void>
	implements ValueStore<Value>
{
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
