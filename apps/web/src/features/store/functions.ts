export function noop() {}

export function id<T>(t: T) {
	return t
}

export function forbidden(x: any): never {
	throw new Error(`unexpected codepath with value: ${x}`)
}

export function exhaustive(x: never): never {
	throw new Error(`unexpected value: ${x}`)
}

export type AnyFunction = (...args: any[]) => any
export function isFunction(u: unknown): u is AnyFunction {
	return typeof u === 'function'
}

export function isPromise(u: unknown): u is Promise<unknown> {
	return typeof u === 'object' && u !== null && isFunction((u as any).then)
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
export type OnChange<T> = (next: T | Reset, last: T) => void

export function defer(callback: () => void) {
	Promise.resolve().then(callback)
}
