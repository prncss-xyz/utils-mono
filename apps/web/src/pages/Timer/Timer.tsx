import { HStack } from '@astryxdesign/core'
import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { toggle, useAtom, useAtomValue } from '@prncss-xyz/react-utils'

import { timerDisplayAtom } from './atoms'
import { runningAtom, timerAtom } from './atoms/timer'

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
		<HStack gap={4} align='center' wrap='wrap'>
			<StartStopButton />
			<TimerDisplay />
			<ResetButton />
		</HStack>
	)
}
