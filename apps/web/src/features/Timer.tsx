import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { Tags } from '@prncss-xyz/react-utils'
import {
	useAtom,
	derivedAtom,
	focusAtom,
	primitiveAtom,
	tag,
	modalMachineAtom,
	useAtomValue,
} from '@prncss-xyz/react-utils'

const timeAtom = primitiveAtom(Date.now, {
	onMount: (_get, set) => {
		set(timeAtom, Date.now())
		const interval = setInterval(() => set(timeAtom, Date.now()), 200)
		return () => clearInterval(interval)
	},
})

const timerAtom = modalMachineAtom<
	{
		start: undefined
		stop: undefined
		reset: undefined
	},
	{
		idle: { elapsed: number }
		running: { since: number }
	},
	Tags<{
		idle: number
		running: number
	}>
>(
	tag('idle', { elapsed: 0 }),
	{
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
	},
	{
		result: {
			idle: ({ elapsed }) => tag('idle', elapsed),
			running: ({ since }, read) => tag('running', read(timeAtom) - since),
		},
	},
)

const toggle = (prop: boolean) => !prop

const runningAtom = focusAtom(timerAtom, {
	getter: (timer) => timer.type === 'running',
	setter: (running) => tag(running ? 'start' : 'stop'),
})

const durationAtom = primitiveAtom(10 * 1000)

const countDownAtom = derivedAtom((read) =>
	Math.max(0, read(durationAtom) - read(timerAtom).payload),
)

function formatTime(time: number) {
	const totalSeconds = Math.ceil(time / 1000)
	const seconds = totalSeconds % 60
	const minutes = Math.floor(totalSeconds / 60) % 60
	const hours = Math.floor(totalSeconds / (60 * 60))
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

const timerDisplayAtom = focusAtom(countDownAtom, {
	getter: formatTime,
})

export function Timer() {
	const timerDisplay = useAtomValue(timerDisplayAtom)
	const [reset, setReset] = useAtom(timerAtom.can, 'reset')
	const [running, setRunning] = useAtom(runningAtom)
	return (
		<VStack gap={4} align='start'>
			<Text>{timerDisplay}</Text>
			<Button
				label={running ? 'Stop' : 'Start'}
				onClick={() => setRunning(toggle)}
			/>
			<Button
				isDisabled={!running && !reset}
				label='Reset'
				onClick={() => setReset()}
			/>
		</VStack>
	)
}
