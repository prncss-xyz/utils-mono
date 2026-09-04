import type { Init } from '../functions'
import type { Sendable, Tags } from '../tags'
import { coreMachineAtom } from './coreMachineAtom'
import type { AtomSymbol, Effect, Read, Write } from './store'

export function modalMachineAtom<Event, State, Result = Tags<State>>(
	init: Init<Tags<State>>,
	states: {
		[S in keyof State]: Partial<{
			[E in keyof Event]: (
				event: Event[E],
				state: State[S],
				read: Read,
				write: Write,
			) => Tags<State> | null | undefined | void
		}>
	},
	opts?: {
		result?: {
			[S in keyof State]: (state: State[S], read: Read) => Result
		}
		factory?: (value: Tags<State>) => AtomSymbol<Tags<State>, any>
		effect?: Effect<Result, Sendable<Event>>
	},
) {
	const { effect, factory, result } = opts ?? {}
	return coreMachineAtom<Event, Tags<State>, Result>(
		init,
		(event, state, read, write) => {
			const handlers = (states as any)[state.type]
			const handler = handlers[event.type]
			if (!handler) return state
			return handler(event.payload, state.payload, read, write) ?? state
		},
		{
			effect,
			factory,
			result: result
				? (state, read) => (result as any)[state.type](state.payload, read)
				: undefined,
		},
	)
}
