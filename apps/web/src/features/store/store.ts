import type { PrimitiveInstance } from './primitive'

export interface Create<V, T, H> {
	create(): T
	pick(t: T, h: H): PrimitiveInstance<V>
}

export class Store {
	private readonly contents = new WeakMap<Create<any, any, any>, any>()
	get<V, T, H>(a: Create<V, T, H>, h: H): PrimitiveInstance<V> {
		let res = this.contents.get(a)
		if (!res) {
			res = a.create()
			this.contents.set(a, res)
		}
		return a.pick(res, h)
	}
}
