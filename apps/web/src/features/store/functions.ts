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
