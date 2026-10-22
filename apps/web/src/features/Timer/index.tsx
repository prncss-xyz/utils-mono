import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import {
	useAtom,
	derivedAtom,
	focusAtom,
	useAtomValue,
	toggle,
} from '@prncss-xyz/react-utils'

import { formatTime } from './formatTime'
import { activeAtom } from './list'
import { runningAtom, timerAtom } from './timer'

const countDownAtom = derivedAtom((read) =>
	Math.max(0, read(activeAtom).duration - read(timerAtom).payload),
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
	const [reset, setReset] = useAtom(timerAtom.can, 'reset')
	const running = useAtomValue(runningAtom)
	return (
		<Button
			isDisabled={!running && !reset}
			label='Reset'
			onClick={() => setReset()}
		/>
	)
}

export function Timer() {
	return (
		<VStack gap={4} align='start'>
			<TimerDisplay />
			<StartStopButton />
			<ResetButton />
		</VStack>
	)
}
