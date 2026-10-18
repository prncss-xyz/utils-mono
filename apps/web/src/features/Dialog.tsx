'use client'

import { AlertDialog, Button, useToast } from '@astryxdesign/core'
import { DialogProvider, useDialog } from '@prncss-xyz/react-utils'

function Coucou2({ message, close }: { message: string; close: () => void }) {
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

function Coucou({ message, close }: { message: string; close: () => void }) {
	const call = useDialog()
	return (
		<AlertDialog
			isOpen
			actionLabel='coucou2'
			title='title'
			description={message}
			onOpenChange={close}
			onAction={() => call(Coucou2, { message: 'Hello from coucou2' })}
		/>
	)
}

function Inner() {
	const call = useDialog()
	return (
		<Button label='open' onClick={() => call(Coucou, { message: 'Coucou' })} />
	)
}

export function Dialog() {
	return (
		<DialogProvider>
			<Inner />
		</DialogProvider>
	)
}
