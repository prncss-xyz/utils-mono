import { isoAssert, RESET } from '@prncss-xyz/react-utils'

export type ListState = {
	nextId: number
	items: { id: string; duration: number }[]
	active: string
}

export function remove(
	{ target }: { target: string },
	{ items, active }: Pick<ListState, 'items' | 'active'>,
) {
	const index = items.findIndex(({ id }) => id === target)
	isoAssert(index !== -1, 'The item to remove must exist')
	if (items.length === 1) return RESET
	const remaining = [...items.slice(0, index), ...items.slice(index + 1)]
	return {
		items: remaining,
		active:
			active === target
				? remaining[Math.min(index, remaining.length - 1)]!.id
				: active,
	}
}

export function create(
	{ source }: { source: string },
	{ nextId, items }: Pick<ListState, 'nextId' | 'items'>,
) {
	const index = items.findIndex(({ id }) => id === source)
	isoAssert(index !== -1, 'The source item must exist')
	const item = items[index]!
	return {
		nextId: nextId + 1,
		items: [
			...items.slice(0, index + 1),
			{ ...item, id: String(nextId) },
			...items.slice(index + 1),
		],
	}
}
