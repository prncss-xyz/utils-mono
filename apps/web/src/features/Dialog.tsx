'use client'

import { AlertDialog, Button, useToast } from '@astryxdesign/core'
import {
	DialogProvider,
	useCallDialog,
	useCloseDialog,
} from '@prncss-xyz/react-utils'

function Coucou2({ message }: { message: string }) {
	const toast = useToast()
	const close = useCloseDialog()
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

function Coucou({ message }: { message: string }) {
	const call = useCallDialog()
	const close = useCloseDialog()
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
	const call = useCallDialog()
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
