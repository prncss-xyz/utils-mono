import {
	Button,
	Dialog,
	DialogHeader,
	Heading,
	HStack,
	TextInput,
	VStack,
} from '@astryxdesign/core'
import {
	isoAssert,
	useAtomValue,
	useDialog,
	useSetAtom,
} from '@prncss-xyz/react-utils'
import { useState } from 'react'

import { clearListAtom, removeListAtom } from './atoms'
import { activeListAtom, allListAtom, allListEvents } from './atoms/list'

function RenameList({ id, close }: { id: string; close: () => void }) {
	const { lists } = useAtomValue(allListAtom)
	const list = lists[id]
	isoAssert(list, 'The list to rename must exist')
	const [name, setName] = useState(list.name)
	const renameList = useSetAtom(allListEvents.renameList)

	return (
		<Dialog isOpen purpose='form' onOpenChange={close}>
			<VStack gap={4}>
				<DialogHeader title='Rename list' onOpenChange={close} />
				<TextInput label='List name' value={name} onChange={setName} />
				<HStack gap={2} hAlign='end' wrap='wrap'>
					<Button label='Cancel' variant='secondary' onClick={close} />
					<Button
						label='Confirm'
						variant='primary'
						onClick={() => {
							renameList({ list: id, name })
							close()
						}}
					/>
				</HStack>
			</VStack>
		</Dialog>
	)
}

export function ListHeading() {
	const { name } = useAtomValue(activeListAtom)
	const { active } = useAtomValue(allListAtom)
	const cloneList = useSetAtom(allListEvents.cloneList)
	const clear = useSetAtom(clearListAtom)
	const remove = useSetAtom(removeListAtom)
	const openDialog = useDialog()
	return (
		<HStack gap={3} align='center' wrap='wrap'>
			<Heading level={2}>{name || 'Untitled list'}</Heading>
			<Button
				size='sm'
				label='Rename list'
				onClick={() => openDialog(RenameList, { id: active })}
			/>
			<Button size='sm' label='Clear list' onClick={() => clear(active)} />
			<Button
				size='sm'
				label='Clone list'
				onClick={() => cloneList({ list: active })}
			/>
			<Button size='sm' label='Remove list' onClick={() => remove(active)} />
		</HStack>
	)
}
