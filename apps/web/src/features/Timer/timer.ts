import { modalMachineAtom, tag, type Tags } from '@prncss-xyz/react-utils'

import { timeAtom } from './time'

export const timerAtom = modalMachineAtom<
	{
		start: undefined
		stop: undefined
		reset: undefined
	},
	{
		idle: { elapsed: number }
		running: { since: number }
	},
	Tags<{
		idle: number
		running: number
	}>
>(
	tag('idle', { elapsed: 0 }),
	{
		idle: {
			start: (_, { elapsed }, read) =>
				tag('running', { since: read(timeAtom) - elapsed }),
			reset: () => tag('idle', { elapsed: 0 }),
		},
		running: {
			stop: (_, { since }, read) =>
				tag('idle', { elapsed: read(timeAtom) - since }),
			reset: (_, _state, read) => tag('running', { since: read(timeAtom) }),
		},
	},
	{
		result: {
			idle: ({ elapsed }) => tag('idle', elapsed),
			running: ({ since }, read) => tag('running', read(timeAtom) - since),
		},
	},
)
