import {
	isoAssert,
	RESET,
	directMachineAtom,
	focusAtom,
} from '@prncss-xyz/react-utils'

import { create, remove } from './operations'

const listAtom = directMachineAtom(
	{
		nextId: 1,
		items: [{ id: '0', duration: 10_000 }],
		active: '0',
	},
	{
		reset: (_: void) => RESET,
		focus: ({ target }: { target: string }) => ({ active: target }),
		remove,
		create,
	},
)

export const activeAtom = focusAtom(listAtom, {
	getter: ({ items, active }) => {
		const item = items.find(({ id }) => id === active)
		isoAssert(item, 'The active item must exist')
		return item
	},
})
