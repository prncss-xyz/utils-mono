'use client'

import { AlertDialog, Button, useToast } from '@astryxdesign/core'
import { DialogProvider, useDialog } from '@prncss-xyz/react-utils'

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

export function Dialog() {
	return (
		<DialogProvider>
			<Inner />
		</DialogProvider>
	)
}
