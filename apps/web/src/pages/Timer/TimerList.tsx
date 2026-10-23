import {
	Button,
	Dialog,
	DialogHeader,
	HStack,
	Text,
	TextInput,
	VStack,
} from '@astryxdesign/core'
import {
	isoAssert,
	tag,
	useAtomValue,
	useDialog,
	useSetAtom,
} from '@prncss-xyz/react-utils'
import { useState } from 'react'

import { activeAtom, removeTimerAtom, updateDurationAtom } from './atoms'
import { formatTime } from './atoms/formatTime'
import { activeListAtom, allListAtom } from './atoms/list'

function EditDuration({ id, close }: { id: string; close: () => void }) {
	const { items } = useAtomValue(activeListAtom)
	const item = items.find((item) => item.id === id)
	isoAssert(item, 'The item to edit must exist')
	const [duration, setDuration] = useState(() => String(item.duration))
	const update = useSetAtom(updateDurationAtom)
	const value = Number(duration)
	const valid = duration.trim() !== '' && Number.isFinite(value) && value >= 0

	return (
		<Dialog isOpen purpose='form' onOpenChange={close}>
			<VStack gap={4}>
				<DialogHeader title='Edit duration' onOpenChange={close} />
				<TextInput
					label='Duration (ms)'
					value={duration}
					onChange={setDuration}
				/>
				<HStack gap={2} hAlign='end'>
					<Button label='Cancel' variant='secondary' onClick={close} />
					<Button
						label='Confirm'
						variant='primary'
						isDisabled={!valid}
						onClick={() => {
							update({ target: id, duration: value })
							close()
						}}
					/>
				</HStack>
			</VStack>
		</Dialog>
	)
}

export function TimerList() {
	const { items, active } = useAtomValue(activeListAtom)
	const updateList = useSetAtom(allListAtom)
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
						label='Clone'
						onClick={() => updateList(tag('clone', { source: id }))}
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
