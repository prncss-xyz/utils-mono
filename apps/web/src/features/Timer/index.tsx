import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import {
	useAtom,
	derivedAtom,
	focusAtom,
	useAtomValue,
	useSetAtom,
	toggle,
} from '@prncss-xyz/react-utils'
import { useEffect } from 'react'

import { cmd } from '../commands'
import { formatTime } from './formatTime'
import { activeAtom } from './list'
import { timeAtom } from './time'
import { elapsedTimeAtom, resetAtom, runningAtom } from './timer'

const fulfilledAtom = derivedAtom(
	(read) => read(elapsedTimeAtom) >= read(activeAtom).duration,
	null,
	{
		effect: (fulfilled, _previous, get, set) => {
			if (fulfilled && get(runningAtom)) {
				set(runningAtom, false)
				set(cmd.toast, 'done')
			}
		},
	},
)

const countDownAtom = derivedAtom((read) =>
	Math.max(0, read(activeAtom).duration - read(elapsedTimeAtom)),
)

const timerDisplayAtom = focusAtom(countDownAtom, { getter: formatTime })

function TimerDisplay() {
	const timerDisplay = useAtomValue(timerDisplayAtom)
	return <Text>{timerDisplay}</Text>
}

function StartStopButton() {
	const [running, setRunning] = useAtom(runningAtom)
	return (
		<Button
			label={running ? 'Stop' : 'Start'}
			onClick={() => setRunning(toggle)}
		/>
	)
}

function ResetButton() {
	const [reset, setReset] = useAtom(resetAtom)
	const running = useAtomValue(runningAtom)
	return (
		<Button
			isDisabled={!running && !reset}
			label='Reset'
			onClick={() => setReset()}
		/>
	)
}

function TimeUpdater() {
	const setTime = useSetAtom(timeAtom)
	useEffect(() => {
		setTime(Date.now())
		const interval = setInterval(() => setTime(Date.now()), 15)
		return () => clearInterval(interval)
	}, [setTime])
	return null
}

export function Timer() {
	useAtomValue(fulfilledAtom)
	return (
		<>
			<TimeUpdater />
			<VStack gap={4} align='start'>
				<TimerDisplay />
				<StartStopButton />
				<ResetButton />
			</VStack>
		</>
	)
}
