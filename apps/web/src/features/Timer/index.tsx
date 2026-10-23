import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import {
	toggle,
	useAtom,
	useAtomValue,
	useDialog,
	useSetAtom,
} from '@prncss-xyz/react-utils'
import { useEffect } from 'react'

import {
	activeAtom,
	fulfilledAtom,
	runningAtom,
	timerDisplayAtom,
} from './atoms'
import { timeAtom } from './atoms/time'
import { timerAtom } from './atoms/timer'
import { EditDuration } from './EditDuration'

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
