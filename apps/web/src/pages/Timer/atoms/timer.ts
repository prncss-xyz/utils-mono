import { focusAtom, modalMachineAtom, tag } from '@prncss-xyz/react-utils'

import { timeAtom } from './time'

export const timerAtom = modalMachineAtom<
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

export const runningAtom = focusAtom(timerAtom, {
	getter: (timer) => timer.type === 'running',
	setter: (next: boolean) => tag(next ? 'start' : 'stop'),
})
