import {
	directMachineAtom,
	focusAtom,
	isoAssert,
	localStorageAtom,
} from '@prncss-xyz/react-utils'
import { z } from 'zod'

import { DEFAULT_DURATION } from './constants'
import {
	activateItem,
	activateList,
	clone,
	cloneList,
	removeList,
	remove,
	renameList,
	clearList,
	update,
} from './operations'

const listStateSchema = z.object({
	name: z.string().default(''),
	items: z
		.array(
			z.object({
				id: z.string(),
				duration: z.number(),
			}),
		)
		.nonempty(),
	active: z.string(),
})

type ListState = z.infer<typeof listStateSchema>

const initList: ListState = {
	name: '',
	items: [{ id: '0', duration: DEFAULT_DURATION }],
	active: '0',
}

const allListsSchema = z.object({
	nextItemId: z.int(),
	nextListId: z.int(),
	active: z.string(),
	lists: z.record(z.string(), listStateSchema),
})

export type AllListsState = z.infer<typeof allListsSchema>

const allListsInit: AllListsState = {
	nextItemId: 1,
	nextListId: 1,
	active: '0',
	lists: {
		'0': initList,
	},
}

export const allListAtom = directMachineAtom(
	allListsInit,
	{
		clearList,
		cloneList,
		removeList,
		renameList,
		activateItem,
		activateList,
		remove,
		clone,
		update,
	},
	{
		factory: (initial) =>
			localStorageAtom(
				'timer-list',
				(raw) => {
					if (raw === null) return initial
					try {
						const result = allListsSchema.safeParse(JSON.parse(raw))
						return result.success ? result.data : initial
					} catch {
						return initial
					}
				},
				JSON.stringify,
			),
	},
)

export const activeListAtom = focusAtom(allListAtom, {
	getter: ({ lists, active }) => {
		const list = lists[active]
		isoAssert(list, 'The active list must exist')
		return list
	},
})
