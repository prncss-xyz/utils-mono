'use client'

import { AlertDialog, Button, useToast } from '@astryxdesign/core'

import { DialogProvider, useDialog } from '@/components/Dialog'

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
	const call = useDialog()
	return (
		<AlertDialog
			isOpen
			actionLabel='coucou2'
			title='title'
			description={message}
			onOpenChange={close}
			onAction={() => {
				call((close) => <Coucou2 close={close} message='Coucou2!' />)
			}}
		/>
	)
}

function Inner() {
	const call = useDialog()
	return (
		<Button
			label='open'
			onClick={() =>
				call((close) => <Coucou close={close} message='Coucou!' />)
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
