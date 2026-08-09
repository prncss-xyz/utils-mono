export function noop(..._args: unknown[]): void {}

export function apply<P, Q>(cb: (p: P) => Q, p: P) {
	return cb(p)
}
