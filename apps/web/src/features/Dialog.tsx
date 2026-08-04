'use client'

import { AlertDialog, Button, useToast } from '@astryxdesign/core'
import { DialogProvider, useDialog, useDialog2 } from '@prncss-xyz/react-utils'

function Coucou2({ close, message }: { message: string; close: () => void }) {
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

function Coucou({ close, message }: { message: string; close: () => void }) {
	const dialog = useDialog()
	return (
		<AlertDialog
			isOpen
			actionLabel='coucou2'
			title='title'
			description={message}
			onOpenChange={close}
			onAction={() => {
				dialog((close) => <Coucou2 close={close} message='Coucou2!' />)
			}}
		/>
	)
}

function Inner() {
	const dialog = useDialog2()
	return (
		<Button
			label='open'
			onClick={() => dialog(Coucou, { message: 'Coucou' })}
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
