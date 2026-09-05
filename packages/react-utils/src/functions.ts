export function noop(..._args: unknown[]): void {}

export function apply<P, Q>(cb: (p: P) => Q, p: P) {
	return cb(p)
}

export function id<T>(t: T) {
	return t
}

export function exhaustive(n: never): never {
	throw new Error(`unexpected value ${n}`)
}

export function isoAssert(
	condition: unknown,
	message?: string,
): asserts condition {
	if (!condition) throw new Error(message ?? 'Assertion failed')
}

export function cached<K, V, Args extends any[]>(
	fn: (k: K, ...args: Args) => V,
) {
	const cache = new Map<K, V>()
	return (k: K, ...args: Args) => {
		if (!cache.has(k)) cache.set(k, fn(k, ...args))
		return cache.get(k) as V
	}
}

export function merge<P extends object>(p: P, q: Partial<P>): P {
	let res: P | undefined = undefined
	for (const k in q) {
		if (res) (res as any)[k] = q[k]
		else if (p[k] !== q[k]) res = { ...p, [k]: q[k] }
	}
	return res ?? p
}

export type AnyFunction = (...args: any[]) => any
export function isFunction(u: unknown): u is AnyFunction {
	return typeof u === 'function'
}

export type Init<T> = T | (() => T)
export function fromInit<T>(init: Init<T>): T {
	return isFunction(init) ? init() : init
}

type Modify<T> = (last: T) => T

type SetState<T> = T | Modify<T>

export const RESET: unique symbol = Symbol(
	import.meta.env?.MODE !== 'production' ? 'RESET' : '',
)
export type Reset = typeof RESET

export function isReset(value: unknown): value is Reset {
	return value === RESET
}

export type SetStateWithReset<T> = SetState<T> | Reset
