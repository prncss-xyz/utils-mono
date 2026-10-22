import { fromInit, isReset, merge, type Init, type Reset } from '../functions'
import type { Tags } from '../tags'
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
			) => Tags<State> | null | undefined | void | Reset
		}>
	},
	opts?: {
		result?: {
			[S in keyof State]: (state: State[S], read: Read) => Result
		}
		factory?: (value: Tags<State>) => AtomSymbol<Tags<State>, any>
		effect?: Effect<Result>
	},
) {
	const { effect, factory, result } = opts ?? {}
	return coreMachineAtom<Event, Tags<State>, Result>(
		init,
		(event, state, read, write) => {
			if (isReset(event)) return fromInit(init)
			const handlers = (states as any)[state.type]
			const handler = handlers[event.type]
			if (!handler) return state
			const next = handler(event.payload, state.payload, read, write)
			if (isReset(next)) return next
			if (next == null) return state
			if (next.type !== state.type) return next
			const payload =
				state.payload !== null &&
				next.payload !== null &&
				typeof state.payload === 'object' &&
				typeof next.payload === 'object'
					? merge(state.payload, next.payload)
					: next.payload
			return merge(state, { ...next, payload })
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
