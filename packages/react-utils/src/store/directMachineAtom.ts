import { merge, type Init } from '../functions'
import type { Sendable } from '../tags'
import { coreMachineAtom } from './coreMachineAtom'
import type { AtomSymbol, Effect, Read, Write } from './store'

export function directMachineAtom<E, S extends object, R = S>(
	init: Init<S>,
	events: {
		[K in keyof E]: (
			payload: E[K],
			state: S,
			read: Read,
			write: Write,
		) => Partial<S> | null | undefined | void
	},
	opts?: {
		result?: (state: S, read: Read) => R
		factory?: (value: S) => AtomSymbol<S, any>
		effect?: Effect<R, Sendable<E>>
	},
) {
	return coreMachineAtom<E, S, R>(
		init,
		(event, state, read, write) => {
			const next = (events as any)[event.type](
				event.payload,
				state,
				read,
				write,
			)
			return next == null ? state : merge(state, next)
		},
		opts,
	)
}
