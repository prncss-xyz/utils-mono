function findIndex<T extends { index: number }>(ts: T[], index: number) {
	let low = 0
	let high = ts.length

	while (low < high) {
		const middle = low + Math.floor((high - low) / 2)

		if (ts[middle]!.index < index) {
			low = middle + 1
		} else {
			high = middle
		}
	}

	return low
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
