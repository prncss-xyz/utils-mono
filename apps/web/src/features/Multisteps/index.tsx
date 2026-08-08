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
	type Prettify,
	tag,
	useLocalStorage,
	useDialog2,
	DialogProvider,
} from '@prncss-xyz/react-utils'
import React, { type ReactNode } from 'react'

type Event<T extends Record<any, (...args: any[]) => any>> = Tags<{
	[K in keyof T]: Parameters<T[K]>[0]
}>

function Id({ children }: { children: ReactNode }) {
	return children
}

function multistep<State extends Record<any, object>, Exit>() {
	return function <
		Init,
		Transitions extends {
			[Type in keyof State]: Record<
				any,
				(res: any, last: State[Type]) => Tags<State & { exit: Exit }>
			>
		},
	>(initializer: (init: Init) => Tags<State>, transitions: Transitions) {
		return function Multistep({
			init,
			steps,
			onExit,
			useState = React.useState,
			Wrap = Id,
		}: {
			init: Init
			steps: {
				[Type in keyof State]: (
					props: Prettify<
						State[Type] & {
							send: (s: Event<Transitions[Type]>) => void
						}
					>,
				) => ReactNode
			}
			onExit: (exit: Exit) => void
			useState?: (
				init: Tags<State>,
			) => readonly [Tags<State>, (next: Tags<State>) => void]
			Wrap?: (props: { children: ReactNode }) => ReactNode
		}): ReactNode {
			const [state, setState] = useState(initializer(init))
			function send(message: any) {
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
			const Step = steps[state.type] as any
			Step.displayName ??= state.type
			return (
				<Wrap>
					<Step {...state.payload} send={send} />
				</Wrap>
			)
		}
	}
}

const Multistep = multistep<
	{
		a: { payload: number }
		b: { payload: string }
	},
	'canceled' | 'bye'
>()((init: number) => tag('a', { payload: init }), {
	a: {
		e: (payload: number) => tag('b', { payload: 'sadf' + payload }),
		close: () => tag('exit', 'canceled' as const),
	},
	b: {
		e: (payload: string) => tag('a', { payload: payload.length + 3 }),
		bye: () => tag('exit', 'bye' as const),
		close: () => tag('exit', 'canceled' as const),
	},
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
		<Multistep
			useState={useFlowState}
			Wrap={({ children }) => (
				<Dialog isOpen onOpenChange={close}>
					<DialogHeader title='Multistep' onOpenChange={close} />
					{children}
				</Dialog>
			)}
			init={4}
			onExit={(body) => {
				toast({ body })
				close()
			}}
			steps={{
				a: ({ payload, send }) => {
					return (
						<VStack gap={3}>
							<Text>a</Text>
							{payload}
							<Button label='e' onClick={() => send(tag('e', payload + 8))} />
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
								onClick={() => send(tag('bye', undefined))}
							/>
						</VStack>
					)
				},
			}}
		/>
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
