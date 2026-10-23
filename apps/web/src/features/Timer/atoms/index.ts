import { derivedAtom, focusAtom, isoAssert, tag } from '@prncss-xyz/react-utils'

import { formatTime } from './formatTime'
import { listAtom } from './list'
import { timeAtom } from './time'
import { timerAtom } from './timer'

export const activeAtom = derivedAtom(
	(read) => {
		const { items, active } = read(listAtom)
		const item = items.find(({ id }) => id === active)
		isoAssert(item, 'The active item must exist')
		return item
	},
	(_read, write, target: string) => {
		write(listAtom, tag('activate', { target }))
		write(timerAtom, 'reset')
	},
)

const elapsedTimeAtom = derivedAtom((read) => {
	const timer = read(timerAtom)
	return timer.type === 'idle'
		? timer.payload.elapsed
		: read(timeAtom) - timer.payload.since
})

export const runningAtom = derivedAtom(
	(read) => read(timerAtom).type === 'running',
	(read, write, update: boolean | ((running: boolean) => boolean)) => {
		const running = read(timerAtom).type === 'running'
		const next = typeof update === 'function' ? update(running) : update
		if (next && !running && read(fulfilledAtom)) write(timerAtom, 'reset')
		write(timerAtom, tag(next ? 'start' : 'stop'))
	},
)

export const fulfilledAtom = derivedAtom(
	(read) => read(elapsedTimeAtom) >= read(activeAtom).duration,
)

const countDownAtom = derivedAtom((read) =>
	Math.max(0, read(activeAtom).duration - read(elapsedTimeAtom)),
)

export const timerDisplayAtom = focusAtom(countDownAtom, { getter: formatTime })

export const updateDurationAtom = derivedAtom(
	null,
	(read, write, update: { target: string; duration: number }) => {
		const { active } = read(listAtom)
		write(listAtom, tag('update', update))
		if (update.target === active) write(timerAtom, 'reset')
	},
)
