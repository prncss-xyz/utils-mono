import {
	fromInit,
	isReset,
	merge,
	type Init,
	type Reset,
} from '../../functions'
import type { AtomSymbol, Effect, Read, Write } from '../store'
import { coreMachineAtom } from './coreMachineAtom'

export function directMachineAtom<E, S extends object, R = S>(
	init: Init<S>,
	events: {
		[K in keyof E]: (
			payload: E[K],
			state: S,
			read: Read,
			write: Write,
		) => Partial<S> | null | undefined | void | Reset
	},
	opts?: {
		result?: (state: S, read: Read) => R
		factory?: (value: S) => AtomSymbol<S, any>
		effect?: Effect<R>
	},
) {
	return coreMachineAtom<E, S, R>(
		init,
		(event, state, read, write) => {
			if (isReset(event)) return fromInit(init)
			const next = (events as any)[event.type](
				event.payload,
				state,
				read,
				write,
			)
			return isReset(next) ? next : next == null ? state : merge(state, next)
		},
		opts,
	)
}
