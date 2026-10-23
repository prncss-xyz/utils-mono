import { isoAssert, RESET } from '@prncss-xyz/react-utils'

import type { ListState } from '.'

export type { ListState } from '.'

export function update(
	{ target, duration }: { target: string; duration: number },
	{ items }: Pick<ListState, 'items'>,
) {
	const index = items.findIndex(({ id }) => id === target)
	isoAssert(index !== -1, 'The item to update must exist')
	return {
		items: items.map((item, itemIndex) =>
			itemIndex === index ? { ...item, duration } : item,
		),
	}
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
