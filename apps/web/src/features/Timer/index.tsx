import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import {
	useAtom,
	derivedAtom,
	focusAtom,
	useAtomValue,
	useDialog,
	useSetAtom,
	toggle,
} from '@prncss-xyz/react-utils'
import { useEffect } from 'react'

import { EditDuration } from './EditDuration'
import { formatTime } from './formatTime'
import { activeAtom } from './list'
import { timeAtom } from './time'
import { elapsedTimeAtom, resetAtom, runningAtom } from './timer'

const fulfilledAtom = derivedAtom(
	(read) => read(elapsedTimeAtom) >= read(activeAtom).duration,
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
	const fulfilled = useAtomValue(fulfilledAtom)
	const reset = useSetAtom(resetAtom)
	return (
		<Button
			label={running ? 'Stop' : 'Start'}
			onClick={() => {
				if (!running && fulfilled) reset()
				setRunning(toggle)
			}}
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

function EditButton() {
	const { id } = useAtomValue(activeAtom)
	const openDialog = useDialog()
	return (
		<Button label='Edit' onClick={() => openDialog(EditDuration, { id })} />
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

function CompletionNotifier() {
	const fulfilled = useAtomValue(fulfilledAtom)
	const [running, setRunning] = useAtom(runningAtom)
	const showToast = useToast()
	useEffect(() => {
		if (fulfilled && running) {
			setRunning(false)
			showToast({ body: 'done' })
		}
	}, [fulfilled, running, setRunning, showToast])
	return null
}

export function Timer() {
	return (
		<>
			<TimeUpdater />
			<CompletionNotifier />
			<VStack gap={4} align='start'>
				<TimerDisplay />
				<StartStopButton />
				<ResetButton />
				<EditButton />
			</VStack>
		</>
	)
}
