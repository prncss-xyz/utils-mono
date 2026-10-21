import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { Tags } from '@prncss-xyz/react-utils'
import {
	derivedAtom,
	primitiveAtom,
	tag,
	modalMachineAtom,
	useAtomValue,
	useSetAtom,
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

const resetAtom = derivedAtom(null, (_read, write) => {
	write(timerAtom, tag('reset'))
})

const toggle = (running: boolean) => !running

const runningAtom = derivedAtom(
	(read) => read(timerAtom).type === 'running',
	(read, write, next: boolean | ((running: boolean) => boolean)) => {
		const running = read(timerAtom).type === 'running'
		const desired = typeof next === 'function' ? next(running) : next
		if (desired !== running) {
			write(timerAtom, tag(desired ? 'start' : 'stop'))
		}
	},
)

function formatTime(time: number) {
	if (time < 0) return ''
	const seconds = Math.floor(time / 1000) % 60
	const minutes = Math.floor(time / (1000 * 60)) % 60
	const hours = Math.floor(time / (1000 * 60 * 60))
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function Timer() {
	useAtomValue(timeAtom)
	const timer = useAtomValue(timerAtom)
	const setRunning = useSetAtom(runningAtom)
	const reset = useSetAtom(resetAtom)
	const isRunning = useAtomValue(runningAtom)

	return (
		<VStack gap={4} align='start'>
			<Text>{formatTime(timer.payload)}</Text>
			<Button
				label={isRunning ? 'Stop' : 'Start'}
				onClick={() => setRunning(toggle)}
			/>
			<Button label='Reset' onClick={() => reset()} />
		</VStack>
	)
}
