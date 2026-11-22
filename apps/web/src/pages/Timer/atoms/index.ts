import { derivedAtom, focusAtom, isoAssert } from '@prncss-xyz/react-utils'

import { formatTime } from './formatTime'
import { activeListAtom, allListAtom, allListEvents } from './list'
import { timeAtom } from './time'
import { runningAtom, timerAtom, timerEvents } from './timer'

export const activeAtom = derivedAtom(
	(read) => {
		const { items, active } = read(activeListAtom)
		const item = items.find(({ id }) => id === active)
		isoAssert(item, 'The active item must exist')
		return item
	},
	(_read, write, target: string) => {
		write(allListEvents.activateItem, { target })
		write(timerEvents.reset)
	},
)

const elapsedTimeAtom = derivedAtom((read) => {
	const timer = read(timerAtom)
	return timer.type === 'idle'
		? timer.payload.elapsed
		: read(timeAtom) - timer.payload.since
})

export const fulfilledAtom = derivedAtom(
	(read) => read(elapsedTimeAtom) >= read(activeAtom).duration,
)

export const completeTimerAtom = derivedAtom(null, (read, write) => {
	if (!read(runningAtom) || !read(fulfilledAtom)) return
	const { items, active } = read(activeListAtom)
	const next = items[items.findIndex(({ id }) => id === active) + 1]
	if (next) {
		write(activeAtom, next.id)
	} else {
		write(runningAtom, false)
		write(timerEvents.reset)
	}
})

const countDownAtom = derivedAtom((read) =>
	Math.max(0, read(activeAtom).duration - read(elapsedTimeAtom)),
)

export const timerDisplayAtom = focusAtom(countDownAtom, { getter: formatTime })

export const updateDurationAtom = derivedAtom(
	null,
	(read, write, update: { target: string; duration: number }) => {
		const { active } = read(activeListAtom)
		write(allListEvents.update, update)
		if (update.target === active) write(timerEvents.reset)
	},
)

export const removeTimerAtom = derivedAtom(
	null,
	(read, write, target: string) => {
		const { active } = read(activeListAtom)
		write(allListEvents.remove, { target })
		if (target === active) write(timerEvents.reset)
	},
)

export const activateListAtom = derivedAtom(
	null,
	(read, write, target: string) => {
		isoAssert(
			read(allListAtom).lists[target],
			'The list to activate must exist',
		)
		write(runningAtom, false)
		write(allListEvents.activateList, { target })
	},
)

export const clearListAtom = derivedAtom(null, (read, write, list: string) => {
	const state = read(allListAtom)
	isoAssert(state.lists[list], 'The list to clear must exist')
	if (state.active === list) {
		write(runningAtom, false)
		write(timerEvents.reset)
	}
	write(allListEvents.clearList, { list })
})

export const removeListAtom = derivedAtom(null, (read, write, list: string) => {
	const state = read(allListAtom)
	isoAssert(state.lists[list], 'The list to remove must exist')
	if (state.active === list) {
		write(runningAtom, false)
		write(timerEvents.reset)
	}
	write(allListEvents.removeList, { list })
})
