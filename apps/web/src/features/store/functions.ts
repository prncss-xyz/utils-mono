export type AnyFunction = (...args: any[]) => any
export function isFunction(u: unknown): u is AnyFunction {
	return typeof u === 'function'
}

export type Init<T> = T | (() => T)
export function fromInit<T>(init: Init<T>): T {
	return isFunction(init) ? init() : init
}

export type Modify<T> = (last: T) => T

export type SetState<T> = T | Modify<T>
export function setState<T>(next: SetState<T>, last: T): T {
	return isFunction(next) ? next(last) : next
}

export const RESET: unique symbol = Symbol(
	import.meta.env?.MODE !== 'production' ? 'RESET' : '',
)
export type Reset = typeof RESET

export function isReset(value: unknown): value is Reset {
	return value === RESET
}

export type SetStateWithReset<T> = SetState<T> | Reset

export function cached<K extends object, V>(
	m: WeakMap<K, V>,
	k: K,
	cb: (k: K) => V,
): V
export function cached<K, V>(m: Map<K, V>, k: K, cb: (k: K) => V): V
export function cached<K, V>(m: any, k: K, cb: (k: K) => V) {
	let res = m.get(k)
	if (res === undefined) {
		res = cb(k)
		m.set(k, res)
	}
	return res
}
