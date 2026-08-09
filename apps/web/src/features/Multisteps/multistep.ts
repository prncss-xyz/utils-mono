import { type Tags } from '@prncss-xyz/react-utils'

type Event<T extends Record<any, (...args: any[]) => any>> = Tags<{
	[K in keyof T]: Parameters<T[K]>[0]
}>

export function multistep<State extends Record<any, any>, Exit = never>() {
	return <
		Init,
		Transitions extends {
			[Type in keyof State]: Record<
				any,
				(res: any, last: State[Type]) => Tags<State & { exit: Exit }>
			>
		},
	>(
		initializer: (init: Init) => Tags<State>,
		transitions: Transitions,
	) =>
		<T>({
			init,
			steps,
			onExit,
			shell,
		}: {
			init: Init
			steps: {
				[Type in keyof State]: (
					payload: State[Type],
					send: (s: Event<Transitions[Type]>) => void,
				) => T
			}
			onExit: (exit: Exit) => void
			shell: (props: {
				state0: Tags<State>
				getStep: (
					state: Tags<State>,
					setState: (next: Tags<State>) => void,
				) => T
			}) => T
		}) =>
			shell({
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
