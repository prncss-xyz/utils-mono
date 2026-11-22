import {
	derivedAtom,
	isFunction,
	modalMachineAtom,
	tag,
} from '@prncss-xyz/react-utils'

import { timeAtom } from './time'

export const [timerAtom, timerEvents] = modalMachineAtom<
	{
		start: void
		stop: void
		reset: void
	},
	{
		idle: { elapsed: number }
		running: { since: number }
	}
>(tag('idle', { elapsed: 0 }), {
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
})

export const runningAtom = derivedAtom(
	(read) => read(timerAtom).type === 'running',
	(read, write, update: boolean | ((running: boolean) => boolean)) => {
		const next = isFunction(update)
			? update(read(timerAtom).type === 'running')
			: update
		write(next ? timerEvents.start : timerEvents.stop)
	},
)
