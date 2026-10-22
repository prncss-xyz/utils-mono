import { fromInit, id, isReset, type Init, type Reset } from '../functions'
import { fromSendable, type Sendable, type Tags } from '../tags'
import { focusAtom, type PreviewAtom } from './focusAtom'
import {
	primitiveAtom,
	type AtomSymbol,
	type Effect,
	type Read,
	type Write,
} from './store'

export type MachineAtom<E, R> = PreviewAtom<R, Sendable<E> | Reset>

/**
 * Creates a writable store symbol backed by a state-machine transition.
 */
export function coreMachineAtom<E, S, R = S>(
	init: Init<S>,
	transition: (
		event: Tags<E> | Reset,
		state: S,
		read: Read,
		write: Write,
	) => S | Reset,
	opts?: {
		result?: (state: S, read: Read) => R
		factory?: (value: S) => AtomSymbol<S, any>
		effect?: Effect<R>
	},
): MachineAtom<E, R> {
	const result = opts?.result ?? (id as (state: S, read: Read) => R)
	const factory: (value: S) => AtomSymbol<S, any> =
		opts?.factory ?? primitiveAtom
	const state = factory(fromInit(init))
	return focusAtom<S, Sendable<E> | Reset, R>(state, {
		getter: result,
		transition: (event, last, read, write) => {
			const next = transition(
				isReset(event) ? event : fromSendable(event),
				last,
				read,
				write,
			)
			return isReset(next) ? fromInit(init) : next
		},
		effect: opts?.effect,
	})
}
