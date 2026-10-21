import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { Tags } from '@prncss-xyz/react-utils'
import {
	derived,
	primitive,
	tag,
	modalMachineAtom,
	useAtomValue,
	useSetAtom,
} from '@prncss-xyz/react-utils'

const timeAtom = primitive(Date.now, {
	onMount: (_get, set) => {
		set(timeAtom, Date.now())
		const interval = setInterval(() => set(timeAtom, Date.now()), 200)
		return () => clearInterval(interval)
	},
})

const timerAtom = modalMachineAtom<
	{
		start: number
		stop: number
		reset: number
	},
	{
		idle: number
		running: number
	},
	Tags<{
		idle: number
		running: number
	}>
>(
	tag('idle', 0),
	{
		idle: {
			start: (now, elapsed) => tag('running', now - elapsed),
			reset: () => tag('idle', 0),
		},
		running: {
			stop: (now, since) => tag('idle', now - since),
			reset: (now) => tag('running', now),
		},
	},
	{
		result: {
			idle: (elapsed) => tag('idle', elapsed),
			running: (since, read) => tag('running', read(timeAtom) - since),
		},
	},
)

const toggleAtom = derived(
	() => undefined,
	(read, write, _event: void) => {
		const timer = read(timerAtom)
		write(
			timerAtom,
			tag(timer.type === 'running' ? 'stop' : 'start', read(timeAtom)),
		)
	},
)

const resetAtom = derived(
	() => undefined,
	(read, write, _event: void) => {
		write(timerAtom, tag('reset', read(timeAtom)))
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
	const toggle = useSetAtom(toggleAtom)
	const reset = useSetAtom(resetAtom)
	const isRunning = timer.type === 'running'

	return (
		<VStack gap={4} align='start'>
			<Text>{formatTime(timer.payload)}</Text>
			<Button label={isRunning ? 'Stop' : 'Start'} onClick={() => toggle()} />
			<Button label='Reset' onClick={() => reset()} />
		</VStack>
	)
}
