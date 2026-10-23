'use client'

import { AlertDialog, Button, useToast } from '@astryxdesign/core'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { VStack } from '@astryxdesign/core/VStack'
import { useDialog } from '@prncss-xyz/react-utils'

type DialogProps<Payload> = {
	message: string
	close: (
		result: { type: 'close' } | { type: 'accept'; payload: Payload },
	) => void
}

function Coucou2({ message, close }: DialogProps<'bye'>) {
	return (
		<AlertDialog
			isOpen
			actionLabel='toast'
			title='title'
			description={message}
			onOpenChange={() => close({ type: 'close' })}
			onAction={() => close({ type: 'accept', payload: 'bye' })}
		/>
	)
}

function Coucou({ message, close }: DialogProps<string>) {
	return (
		<AlertDialog
			isOpen
			actionLabel='coucou2'
			title='title'
			description={message}
			onOpenChange={() => close({ type: 'close' })}
			onAction={() => close({ type: 'accept', payload: 'Hello from coucou2' })}
		/>
	)
}

function Inner() {
	const call = useDialog()
	const toast = useToast()
	return (
		<Button
			label='open'
			onClick={() =>
				call(Coucou, { message: 'Coucou' }, (result) => {
					if (result.type === 'accept') {
						call(Coucou2, { message: result.payload }, (result) => {
							if (result.type === 'accept') toast({ body: result.payload })
						})
					}
				})
			}
		/>
	)
}

function Dialog() {
	return <Inner />
}

export default function DialogPage() {
	return (
		<AppShell contentPadding={0} height='auto' variant='wash'>
			<VStack gap={0}>
				<Section variant='transparent' padding={10}>
					<Heading level={1} type='display-1' textWrap='balance'>
						Dialog
					</Heading>
				</Section>

				<Section variant='section' padding={10} dividers={['top']}>
					<Dialog />
				</Section>
			</VStack>
		</AppShell>
	)
}
