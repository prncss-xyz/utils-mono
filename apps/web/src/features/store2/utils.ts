function findIndex<T extends { symbol: { index: number } }>(
	ts: T[],
	index: number,
) {
	const position = ts.findIndex((value) => value.symbol.index >= index)
	return position === -1 ? ts.length : position
}

// do we really need the order, if not a direct lookup might be faster
export function sortedPush<T extends { symbol: { index: number } }>(
	ts: T[],
	t: T,
) {
	const index = findIndex(ts, t.symbol.index)

	if (ts[index]?.symbol.index === t.symbol.index) return ts

	ts.splice(index, 0, t)
}

// might be faster to use direct lookup
export function sortedRemove<T extends { symbol: { index: number } }>(
	ts: T[],
	t: T,
) {
	const position = findIndex(ts, t.symbol.index)

	if (ts[position]?.symbol.index !== t.symbol.index) return ts

	ts.splice(position, 1)
}

export function call(cb: () => void) {
	cb()
}

export function isMounted(value: { mounted: boolean }) {
	return value.mounted
}
