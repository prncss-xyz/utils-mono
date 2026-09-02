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
