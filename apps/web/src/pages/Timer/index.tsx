import { HStack } from '@astryxdesign/core'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { Text } from '@astryxdesign/core/Text'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import {
	toggle,
	tag,
	useAtom,
	useAtomValue,
	useDialog,
	useSetAtom,
} from '@prncss-xyz/react-utils'
import { useEffect } from 'react'

import {
	activeAtom,
	completeTimerAtom,
	removeTimerAtom,
	fulfilledAtom,
	timerDisplayAtom,
} from './atoms'
import { formatTime } from './atoms/formatTime'
import { listAtom } from './atoms/list'
import { timeAtom } from './atoms/time'
import { runningAtom, timerAtom } from './atoms/timer'
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
	const running = useAtomValue(runningAtom)
	const active = useAtomValue(activeAtom)
	const complete = useSetAtom(completeTimerAtom)
	const showToast = useToast()
	useEffect(() => {
		if (fulfilled && running) {
			complete()
			showToast({ body: 'done' })
		}
	}, [fulfilled, running, active, complete, showToast])
	return null
}

function Timer() {
	return (
		<HStack gap={4} align='center' wrap='wrap'>
			<StartStopButton />
			<TimerDisplay />
			<ResetButton />
		</HStack>
	)
}

function TimerList() {
	const [{ items, active }, updateList] = useAtom(listAtom)
	const activate = useSetAtom(activeAtom)
	const remove = useSetAtom(removeTimerAtom)
	const openDialog = useDialog()

	return (
		<VStack
			as='ul'
			gap={1}
			aria-label='Timers'
			style={{ listStyle: 'none', margin: 0, padding: 0 }}
		>
			{items.map(({ id, duration }) => (
				<HStack
					as='li'
					key={id}
					gap={3}
					padding={3}
					align='center'
					wrap='wrap'
					style={{
						backgroundColor:
							id === active ? 'var(--color-accent-muted)' : undefined,
					}}
				>
					<Button
						size='sm'
						label={id === active ? 'Active' : 'Activate'}
						isDisabled={id === active}
						onClick={() => activate(id)}
					/>
					<Text>{formatTime(duration)}</Text>
					<Button size='sm' label='Remove' onClick={() => remove(id)} />
					<Button
						size='sm'
						label='Duplicate'
						onClick={() => updateList(tag('create', { source: id }))}
					/>
					<Button
						size='sm'
						label='Edit'
						onClick={() => openDialog(EditDuration, { id })}
					/>
				</HStack>
			))}
		</VStack>
	)
}

export default function TimerPage() {
	return (
		<>
			<TimeUpdater />
			<CompletionNotifier />
			<AppShell contentPadding={0} height='auto' variant='wash'>
				<Section variant='transparent' padding={10}>
					<VStack gap={4} align='start'>
						<Heading level={1} type='display-1' textWrap='balance'>
							Timer
						</Heading>
						<Timer />
						<TimerList />
					</VStack>
				</Section>
			</AppShell>
		</>
	)
}
