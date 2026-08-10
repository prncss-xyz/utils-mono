import type { Tag } from './types'

export function tag<P extends PropertyKey>(p: P): Tag<P, undefined>
export function tag<P extends PropertyKey, const Z>(p: P, z: Z): Tag<P, Z>
export function tag<P extends PropertyKey, Q extends PropertyKey, const Z>(
	p: P,
	q: Q,
	z: Z,
): Tag<P, Tag<Q, Z>>
export function tag<
	P extends PropertyKey,
	Q extends PropertyKey,
	R extends PropertyKey,
	const Z,
>(p: P, q: Q, r: R, z: Z): Tag<P, Tag<Q, Tag<R, Z>>>
export function tag<
	P extends PropertyKey,
	Q extends PropertyKey,
	R extends PropertyKey,
	S extends PropertyKey,
	const Z,
>(p: P, q: Q, r: R, s: S, z: Z): Tag<P, Tag<Q, Tag<R, Tag<S, Z>>>>
export function tag<
	P extends PropertyKey,
	Q extends PropertyKey,
	R extends PropertyKey,
	S extends PropertyKey,
	T extends PropertyKey,
	const Z,
>(p: P, q: Q, r: R, s: S, t: T, z: Z): Tag<P, Tag<Q, Tag<R, Tag<S, Tag<T, Z>>>>>
export function tag<
	P extends PropertyKey,
	Q extends PropertyKey,
	R extends PropertyKey,
	S extends PropertyKey,
	T extends PropertyKey,
	U extends PropertyKey,
	const Z,
>(
	p: P,
	q: Q,
	r: R,
	s: S,
	t: T,
	u: U,
	z: Z,
): Tag<P, Tag<Q, Tag<R, Tag<S, Tag<T, Tag<U, Z>>>>>>
