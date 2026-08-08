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
import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useState,
} from 'react'

type Event<T extends Record<any, (...args: any[]) => any>> = Tags<{
	[K in keyof T]: Parameters<T[K]>[0]
}>

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
		return function Multistep<T>({
			init,
			steps,
			onExit,
			impl,
		}: {
			init: Init
			steps: {
				[Type in keyof State]: (
					payload: State[Type],
					send: (s: Event<Transitions[Type]>) => void,
				) => T
			}
			onExit: (exit: Exit) => void
			impl: (state0: Tags<State>, getStep: any) => T
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
			return impl(initializer(init), getStep)
		}
	}
}

function noop(..._args: unknown[]): void {}

function Impl<State>({
	state0,
	getStep,
}: {
	state0: State
	getStep: (
		state: State,
		setState: Dispatch<SetStateAction<State>>,
	) => ReactNode
}) {
	const [now] = useState(() => Date.now())
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

function FlowDialog({ close }: { close: () => void }) {
	const toast = useToast()
	return (
		<Multistep
			init={4}
			onExit={(body) => {
				toast({ body })
				close()
			}}
			impl={(state0, getStep) => <Impl state0={state0} getStep={getStep} />}
			steps={{
				a: ({ payload }, send) => {
					return (
						<>
							<Text>a: {payload}</Text>
							<Button label='e' onClick={() => send(tag('e', payload + 8))} />
						</>
					)
				},
				b: ({ payload }, send) => {
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
