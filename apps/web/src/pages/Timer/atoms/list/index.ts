import {
	RESET,
	directMachineAtom,
	localStorageAtom,
} from '@prncss-xyz/react-utils'
import { z } from 'zod'

import { create, remove, update } from './operations'

const listStateSchema = z
	.object({
		nextId: z.int().positive(),
		items: z
			.array(
				z.object({
					id: z.string().regex(/^(0|[1-9]\d*)$/),
					duration: z.number().nonnegative(),
				}),
			)
			.nonempty(),
		active: z.string(),
	})
	.refine(
		({ items, active, nextId }) =>
			items.some(({ id }) => id === active) &&
			new Set(items.map(({ id }) => id)).size === items.length &&
			items.every(({ id }) => Number(id) < nextId),
		'Active timer must exist, IDs must be unique, and nextId must exceed all IDs',
	)

export type ListState = z.infer<typeof listStateSchema>

export const listAtom = directMachineAtom(
	{
		nextId: 1,
		items: [{ id: '0', duration: 1_000 }],
		active: '0',
	},
	{
		reset: (_: void) => RESET,
		activate: ({ target }: { target: string }) => ({ active: target }),
		remove,
		create,
		update,
	},
	{
		factory: (initial) =>
			localStorageAtom(
				'timer-list',
				(raw) => {
					if (raw === null) return initial
					try {
						const result = listStateSchema.safeParse(JSON.parse(raw))
						return result.success ? result.data : initial
					} catch {
						return initial
					}
				},
				JSON.stringify,
			),
	},
)
