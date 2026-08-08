'use client'

import { Button, Dialog, Text, useToast, VStack } from '@astryxdesign/core'
import {
	type Tags,
	type Prettify,
	tag,
	useLocalStorage,
	useDialog2,
	DialogProvider,
} from '@prncss-xyz/react-utils'
import React, { type ReactNode } from 'react'

type Event<T extends Record<any, (...args: any[]) => any>, Exit> = Tags<
	{
		[K in keyof T]: Parameters<T[K]>[0]
	} & { exit: Exit }
>

function multistep<State extends Record<any, object>, Exit>() {
	return function <
		Init,
		Transitions extends {
			[Type in keyof State]: Record<
				any,
				(res: any, last: State[Type]) => Tags<State>
			>
		},
	>(initializer: (init: Init) => Tags<State>, transitions: Transitions) {
		return function Multistep({
			init,
			steps,
			onExit,
			useState = React.useState,
		}: {
			init: Init
			steps: {
				[Type in keyof State]: (
					props: Prettify<
						State[Type] & {
							send: (s: Event<Transitions[Type], Exit>) => void
						}
					>,
				) => ReactNode
			}
			onExit: (exit: Exit) => void
			useState?: (
				init: Tags<State>,
			) => readonly [Tags<State>, (next: Tags<State>) => void]
		}): ReactNode {
			const [state, setState] = useState(initializer(init))
			function send(message: any) {
				if (message.type === 'exit') {
					onExit(message.payload)
					return
				}
				setState(
					transitions[state.type][message.type]!(
						message.payload,
						state.payload as any,
					),
				)
			}
			const Step = steps[state.type] as any
			Step.displayName ??= state.type
			return <Step {...state.payload} send={send} />
		}
	}
}

const Multistep = multistep<
	{
		a: { payload: number }
		b: { payload: string }
	},
	string
>()((init: number) => tag('a', { payload: init }), {
	a: { e: (payload: number) => tag('b', { payload: 'sadf' + payload }) },
	b: { e: (payload: string) => tag('a', { payload: payload.length + 3 }) },
})

function useFlowState<S>(init: S) {
	return useLocalStorage(
		'multistep',
		(raw) => {
			if (raw == null) return init
			return JSON.parse(raw) as never
		},
		JSON.stringify as never,
	)
}

function FlowDialog({ close }: { close: () => void }) {
	const toast = useToast()
	return (
		<Dialog isOpen onOpenChange={close}>
			<Multistep
				useState={useFlowState}
				init={4}
				onExit={(body) => toast({ body })}
				steps={{
					a: ({ payload, send }) => {
						return (
							<VStack gap={3}>
								<Text>a</Text>
								{payload}
								<Button label='e' onClick={() => send(tag('e', payload + 8))} />
								<Button
									label='exit'
									onClick={() => send(tag('exit', 'bye from a'))}
								/>
							</VStack>
						)
					},
					b: ({ payload, send }) => {
						return (
							<VStack gap={3}>
								<Text>b</Text>
								{payload}
								<Button
									label='e'
									onClick={() => send(tag('e', 'agew' + String(payload)))}
								/>
								<Button
									label='exit'
									onClick={() => {
										send(tag('exit', 'bye from b'))
										close()
									}}
								/>
							</VStack>
						)
					},
				}}
			/>
		</Dialog>
	)
}

function Content() {
	const dialoag = useDialog2()
	return <Button label='start' onClick={() => dialoag(FlowDialog, {})} />
}

export function Demo() {
	return (
		<DialogProvider>
			<Content />
		</DialogProvider>
	)
}
