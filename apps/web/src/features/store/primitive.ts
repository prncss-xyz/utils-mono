import {
	fromInit,
	isFunction,
	isReset,
	type Init,
	type SetStateWithReset,
} from './functions'
import type { OnMount } from './mount'
import { Subscribed } from './subscribed'

export type ValueStore<Value> = Subscribed<Value, [Value], void>

export function primitive<Value>(init: Init<Value>, onMount?: OnMount) {
	return new PrimitiveStore(init, onMount)
}

export class PrimitiveStore<Value>
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
