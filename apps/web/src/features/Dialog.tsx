'use client'

import { AlertDialog, Button, useToast } from '@astryxdesign/core'

import { DialogProvider, useDialog } from '@/components/Dialog'

function Coucou({ close, message }: { message: string; close: () => void }) {
	const toast = useToast()
	return (
		<AlertDialog
			isOpen
			actionLabel='toast'
			title='title'
			description={message}
			onOpenChange={close}
			onAction={() => {
				close()
				toast({ body: 'bye' })
			}}
		/>
	)
}

function Inner() {
	const [call, close] = useDialog()
	return (
		<Button
			label='open'
			onClick={() => call(<Coucou close={close} message='Coucou!' />)}
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
