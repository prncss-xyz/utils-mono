import type { PrimitiveInstance } from './primitive'

export interface Atom<V, H> {
	create(h: H): any
	pick(t: any, h: H): PrimitiveInstance<V>
}

export class Store {
	private readonly contents = new WeakMap<Atom<any, any>, any>()
	get<V, H>(a: Atom<V, H>, h: H): PrimitiveInstance<V> {
		let res = this.contents.get(a)
		if (!res) {
			res = a.create(h)
			this.contents.set(a, res)
		}
		return a.pick(res, h)
	}
}
