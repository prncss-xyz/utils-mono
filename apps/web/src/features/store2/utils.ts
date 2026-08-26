function findIndex<T extends { index: number }>(ts: T[], index: number) {
	const position = ts.findIndex((value) => value.index >= index)
	return position === -1 ? ts.length : position
}

// do we really nead the order, if not a direct lookup might be faster
export function sortedPush<T extends { index: number }>(ts: T[], t: T) {
	const index = findIndex(ts, t.index)

	if (ts[index]?.index === t.index) return ts

	ts.splice(index, 0, t)
}

// might be faster to use direct lookup
export function sortedRemove<T extends { index: number }>(ts: T[], t: T) {
	const position = findIndex(ts, t.index)

	if (ts[position]?.index !== t.index) return ts

	ts.splice(position, 1)
}

/**
 * @param {Scope} scope - Must be sorted by AtomSymbol index
 * @param {AtomSymbol<T, any>} a - The atom symbol to bind
 * @param {T} v - The value to bind
 * destructively add a [atom, value] binding to the scope
 * sorting is preserved, rebinding a value does nothing if values are equal and throws if they are not
 */
export function addScope(
	scope: [{ index: number }, unknown][],
	a: { index: number },
	v: unknown,
): void {
	const found = scope.findIndex(([{ index }]) => index >= a.index)
	const position = found === -1 ? scope.length : found
	const binding = scope[position]

	if (binding?.[0].index === a.index) {
		if (Object.is(binding[1], v)) return
		throw new Error(`Atom ${a.index} is already bound to a different value`)
	}

	scope.splice(position, 0, [a, v])
}
