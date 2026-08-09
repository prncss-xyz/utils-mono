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
	type Tags,
	tag,
	useCallDialog,
	useCloseDialog,
	DialogProvider,
} from '@prncss-xyz/react-utils'
import { type ReactNode, useState } from 'react'

type Event<T extends Record<any, (...args: any[]) => any>> = Tags<{
	[K in keyof T]: Parameters<T[K]>[0]
}>

function multistep<State extends Record<any, any>, Exit = never>() {
	return function <
		Init,
		Transitions extends {
			[Type in keyof State]: Record<
				any,
				(res: any, last: State[Type]) => Tags<State & { exit: Exit }>
			>
		},
	>(initializer: (init: Init) => Tags<State>, transitions: Transitions) {
		return function <T>({
			init,
			steps,
			onExit,
			wrap,
		}: {
			init: Init
			steps: {
				[Type in keyof State]: (
					payload: State[Type],
					send: (s: Event<Transitions[Type]>) => void,
				) => T
			}
			onExit: (exit: Exit) => void
			wrap: (props: {
				state0: Tags<State>
				getStep: (
					state: Tags<State>,
					setState: (next: Tags<State>) => void,
				) => T
			}) => T
		}) {
			return wrap({
				state0: initializer(init),
				getStep: (state, setState) => {
					return (steps[state.type] as any)(state.payload, (message: any) => {
						const next: any = transitions[state.type][message.type]!(
							message.payload,
							state.payload as any,
						)
						if (next.type === 'exit') {
							onExit(next.payload)
							return
						}
						setState(next)
					})
				},
			})
		}
	}
}

function InDialog<State>({
	state0,
	getStep,
}: {
	state0: State
	getStep: (state: State, setState: (state: State) => void) => ReactNode
}) {
	const close = useCloseDialog()
	const [now] = useState(() => {
		return Date.now()
	})
	return (
		<Dialog isOpen onOpenChange={close}>
			<DialogHeader title='Multistep' onOpenChange={close} />
			<VStack gap={3}>
				<Text>{now}</Text>
				{getStep(...useState(state0))}
			</VStack>
		</Dialog>
	)
}

const Multistep = multistep<
	{
		a: number
		b: string
	},
	'canceled' | 'bye'
>()((init: number) => tag('a', init), {
	a: {
		e: (payload: number) => tag('b', 'sadf' + payload),
	},
	b: {
		e: (payload: string) => tag('a', payload.length + 3),
		bye: () => tag('exit', 'bye' as const),
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
				a: (payload, send) => {
					return (
						<>
							<Text>a: {payload}</Text>
							<Button label='e' onClick={() => send(tag('e', payload + 8))} />
						</>
					)
				},
				b: (payload, send) => {
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
			wrap={InDialog}
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
