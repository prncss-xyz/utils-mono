import {
	Button,
	Dialog,
	DialogHeader,
	HStack,
	TextInput,
	VStack,
} from '@astryxdesign/core'
import {
	isoAssert,
	tag,
	useAtomValue,
	useSetAtom,
} from '@prncss-xyz/react-utils'
import { useState } from 'react'

import { listAtom } from './list'

export function EditDuration({ id, close }: { id: string; close: () => void }) {
	const { items } = useAtomValue(listAtom)
	const item = items.find((item) => item.id === id)
	isoAssert(item, 'The item to edit must exist')
	const [duration, setDuration] = useState(() => String(item.duration))
	const update = useSetAtom(listAtom)
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
							update(tag('update', { target: id, duration: value }))
							close()
						}}
					/>
				</HStack>
			</VStack>
		</Dialog>
	)
}
