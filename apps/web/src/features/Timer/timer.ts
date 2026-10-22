import {
	derivedAtom,
	focusAtom,
	modalMachineAtom,
	tag,
} from '@prncss-xyz/react-utils'

import { timeAtom } from './time'

const timerAtom = modalMachineAtom<
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

export const resetAtom = derivedAtom(
	(read) => read(timerAtom.can, 'reset'),
	(_read, write) => write(timerAtom, 'reset'),
)

export const elapsedTimeAtom = derivedAtom((read) => {
	const timer = read(timerAtom)
	return timer.type === 'idle'
		? timer.payload.elapsed
		: read(timeAtom) - timer.payload.since
})

export const runningAtom = focusAtom(timerAtom, {
	getter: (timer) => timer.type === 'running',
	setter: (running) => tag(running ? 'start' : 'stop'),
})
