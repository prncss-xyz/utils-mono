'use client'

import {
	Button,
	Dialog,
	DialogHeader,
	Text,
	useToast,
	VStack,
} from '@astryxdesign/core'
import {
	tag,
	useCallDialog,
	useCloseDialog,
	DialogProvider,
} from '@prncss-xyz/react-utils'
import { createElement, type ReactElement, useState } from 'react'

import { multistep, type ShellProps } from './multistep'

function InDialog<State>({ state0, getStep }: ShellProps<ReactElement, State>) {
	const close = useCloseDialog()
	const [now] = useState(() => Date.now())
	return (
		<Dialog isOpen onOpenChange={close}>
			<DialogHeader title='Multistep' onOpenChange={close} />
			<VStack gap={3}>
				<Text>{now}</Text>
				{getStep(createElement, ...useState(state0))}
			</VStack>
		</Dialog>
	)
}

const Multistep = multistep<
	{
		a: number
		b: string
	},
	string
>()((init: number) => tag('a', init), {
	a: {
		e: (payload: number) => tag('b', 'sadf' + payload),
	},
	b: {
		e: (payload: string) => tag('a', payload.length + 3),
		bye: () => tag('exit', 'bye'),
	},
})

function FlowDialog() {
	const toast = useToast()
	const close = useCloseDialog()
	return (
		<Multistep
			init={4}
			onExit={(body) => {
				toast({ body })
				close()
			}}
			steps={{
				a: function A({ payload, send }) {
					const [x] = useState(3)
					return (
						<>
							<Text>a: {payload}</Text>
							<Text>{x}</Text>
							<Button label='e' onClick={() => send(tag('e', payload + 8))} />
						</>
					)
				},
				b: ({ payload, send }) => {
					return (
						<>
							<Text>b: {payload}</Text>
							<Button
								label='e'
								onClick={() => send(tag('e', 'agew' + String(payload)))}
							/>
							<Button
								label='exit'
								onClick={() => send(tag('bye', undefined))}
							/>
						</>
					)
				},
			}}
			shell={InDialog}
		/>
	)
}

function Content() {
	const call = useCallDialog()
	return <Button label='start' onClick={() => call(FlowDialog)} />
}

export function Demo() {
	return (
		<DialogProvider>
			<Content />
		</DialogProvider>
	)
}
