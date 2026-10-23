'use client'

import {
	Button,
	Dialog,
	DialogHeader,
	Text,
	useToast,
	VStack,
} from '@astryxdesign/core'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { tag, useDialog } from '@prncss-xyz/react-utils'
import { createElement, type ReactElement, useState } from 'react'

import { multistep, type ShellProps } from './multistep'

function InDialog<State>({
	state0,
	getStep,
	close,
}: ShellProps<ReactElement, State> & { close: () => void }) {
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

function FlowDialog({ close }: { close: () => void }) {
	const toast = useToast()
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
			shell={(props) => <InDialog {...props} close={close} />}
		/>
	)
}

function Content() {
	const openDialog = useDialog()
	return <Button label='start' onClick={() => openDialog(FlowDialog, {})} />
}

function Demo() {
	return <Content />
}

export default function MultistepsPage() {
	return (
		<AppShell contentPadding={0} height='auto' variant='wash'>
			<VStack gap={0}>
				<Section variant='transparent' padding={10}>
					<Heading level={1} type='display-1' textWrap='balance'>
						Multisteps
					</Heading>
				</Section>

				<Section variant='section' padding={10} dividers={['top']}>
					<Demo />
				</Section>
			</VStack>
		</AppShell>
	)
}
