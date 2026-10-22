import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import {
	useAtom,
	derivedAtom,
	focusAtom,
	tag,
	useAtomValue,
} from '@prncss-xyz/react-utils'

import { formatTime } from './formatTime'
import { activeAtom } from './list'
import { timerAtom } from './timer'

const toggle = (prop: boolean) => !prop

const runningAtom = focusAtom(timerAtom, {
	getter: (timer) => timer.type === 'running',
	setter: (running) => tag(running ? 'start' : 'stop'),
})

const countDownAtom = derivedAtom((read) =>
	Math.max(0, read(activeAtom).duration - read(timerAtom).payload),
)

const timerDisplayAtom = focusAtom(countDownAtom, { getter: formatTime })

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
