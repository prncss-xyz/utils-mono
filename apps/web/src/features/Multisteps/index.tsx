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
	useDialog2,
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
		return function Multistep<T>({
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
			wrap: (
				state0: Tags<State>,
				getStep: (
					state: Tags<State>,
					setState: (next: Tags<State>) => void,
				) => T,
			) => T
		}) {
			function getStep(
				state: Tags<State>,
				setState: (next: Tags<State>) => void,
			) {
				const send = (message: any) => {
					const next: any = transitions[state.type][message.type]!(
						message.payload,
						state.payload as any,
					)
					if (next.type === 'exit') {
						onExit(next.payload)
						return
					}
					setState(next)
				}
				return (steps[state.type] as any)(state.payload, send)
			}
			return wrap(initializer(init), getStep)
		}
	}
}

function noop(..._args: unknown[]): void {}

function Wrap<State>({
	state0,
	getStep,
}: {
	state0: State
	getStep: (state: State, setState: (state: State) => void) => ReactNode
}) {
	const [now] = useState(() => {
		return Date.now()
	})
	return (
		<Dialog isOpen onOpenChange={noop}>
			<DialogHeader title='Multistep' onOpenChange={noop} />
			<VStack gap={3}>
				<Text>{now}</Text>
				{getStep(...useState(state0))}
			</VStack>
		</Dialog>
	)
}

function inDialog<State>(
	state0: State,
	getStep: (state: State, setState: (state: State) => void) => ReactNode,
) {
	return <Wrap state0={state0} getStep={getStep} />
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
		close: () => tag('exit', 'canceled' as const),
	},
	b: {
		e: (payload: string) => tag('a', payload.length + 3),
		bye: () => tag('exit', 'bye' as const),
		close: () => tag('exit', 'canceled' as const),
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
			wrap={inDialog}
		/>
	)
}

function Content() {
	const dialog = useDialog2()
	return <Button label='start' onClick={() => dialog(FlowDialog, {})} />
}

export function Demo() {
	return (
		<DialogProvider>
			<Content />
		</DialogProvider>
	)
}
