import {
	fromInit,
	isFunction,
	isReset,
	type Init,
	type SetStateWithReset,
} from './functions'
import type { OnMount } from './mount'
import type { Create } from './store'
import { Subscribed } from './subscribed'

export type ValueStore<Value> = Subscribed<Value, [Value], void>

export function primitive<V>(
	init: Init<V>,
): Create<V, PrimitiveInstance<V>, void> {
	return new Primitive(init)
}

export class Primitive<Value, Hash> implements Create<
	Value,
	any,
	Hash
> {
	readonly init
	constructor(init: Init<Value>) {
		this.init = init
	}
	create() {
		return new PrimitiveInstance(fromInit(this.init))
	}
	pick(a: PrimitiveInstance<Value>) {
		return a
	}
}

export class Group<Value> implements Create<
	Value,
	Map<string, PrimitiveInstance<Value>>,
	string
> {
	readonly init
	constructor(init: Init<Value>) {
		this.init = init
	}
	create() {
		return new Map<string, PrimitiveInstance<Value>>()
	}
	pick(a: Map<string, PrimitiveInstance<Value>>, hash: string) {
		let res = a.get(hash)
		if (!res) {
			res = new PrimitiveInstance(fromInit(this.init))
			a.set(hash, res)
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
