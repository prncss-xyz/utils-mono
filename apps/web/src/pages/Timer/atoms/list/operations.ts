import { isoAssert } from '@prncss-xyz/react-utils'

import type { AllListsState } from '.'
import { DEFAULT_DURATION } from './constants'

function findList(target: string, { lists }: AllListsState) {
	const entry = Object.entries(lists).find(([, list]) =>
		list.items.some(({ id }) => id === target),
	)
	isoAssert(entry, 'The target item must exist')
	return entry
}

export function clearList({ list }: { list: string }, state: AllListsState) {
	isoAssert(state.lists[list], 'The list to clear must exist')
	const id = String(state.nextItemId)
	return {
		nextItemId: state.nextItemId + 1,
		lists: {
			...state.lists,
			[list]: {
				...state.lists[list],
				items: [{ id, duration: DEFAULT_DURATION }],
				active: id,
			},
		},
	}
}

export function activateItem(
	{ target }: { target: string },
	state: AllListsState,
) {
	const [key, list] = findList(target, state)
	return { lists: { ...state.lists, [key]: { ...list, active: target } } }
}

export function update(
	{ target, duration }: { target: string; duration: number },
	state: AllListsState,
) {
	const [key, list] = findList(target, state)
	return {
		lists: {
			...state.lists,
			[key]: {
				...list,
				items: list.items.map((item) =>
					item.id === target ? { ...item, duration } : item,
				),
			},
		},
	}
}

export function remove({ target }: { target: string }, state: AllListsState) {
	const [key, list] = findList(target, state)
	if (list.items.length === 1) return clearList({ list: key }, state)
	const index = list.items.findIndex(({ id }) => id === target)
	const items = list.items.filter(({ id }) => id !== target)
	return {
		lists: {
			...state.lists,
			[key]: {
				...list,
				items,
				active:
					list.active === target
						? items[Math.min(index, items.length - 1)]!.id
						: list.active,
			},
		},
	}
}

export function clone({ source }: { source: string }, state: AllListsState) {
	const [key, list] = findList(source, state)
	const index = list.items.findIndex(({ id }) => id === source)
	return {
		nextItemId: state.nextItemId + 1,
		lists: {
			...state.lists,
			[key]: {
				...list,
				items: [
					...list.items.slice(0, index + 1),
					{ ...list.items[index]!, id: String(state.nextItemId) },
					...list.items.slice(index + 1),
				],
			},
		},
	}
}

export function renameList(
	{ list, name }: { list: string; name: string },
	state: AllListsState,
) {
	const current = state.lists[list]
	isoAssert(current, 'The list to rename must exist')
	return { lists: { ...state.lists, [list]: { ...current, name } } }
}

export function activateList(
	{ target }: { target: string },
	state: AllListsState,
) {
	isoAssert(state.lists[target], 'The list to activate must exist')
	return { active: target }
}

export function cloneList({ list }: { list: string }, state: AllListsState) {
	const source = state.lists[list]
	isoAssert(source, 'The list to clone must exist')
	const items = source.items.map((item, index) => ({
		...item,
		id: String(state.nextItemId + index),
	}))
	const activeIndex = source.items.findIndex(({ id }) => id === source.active)
	isoAssert(items[activeIndex], 'The active item must exist')
	return {
		nextListId: state.nextListId + 1,
		nextItemId: state.nextItemId + items.length,
		lists: {
			...state.lists,
			[String(state.nextListId)]: {
				...source,
				items,
				active: items[activeIndex].id,
			},
		},
	}
}

export function removeList({ list }: { list: string }, state: AllListsState) {
	isoAssert(state.lists[list], 'The list to remove must exist')
	const lists = { ...state.lists }
	delete lists[list]
	const next = Object.keys(lists)[0]
	if (next === undefined) return clearList({ list }, state)
	return { lists, active: state.active === list ? next : state.active }
}
