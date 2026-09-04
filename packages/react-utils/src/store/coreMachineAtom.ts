import { fromInit, id, noop, type Init } from '../functions'
import { fromSendable, type Sendable, type Tags } from '../tags'
import {
	derived,
	family,
	primitive,
	TRANSIENT,
	type AtomFamily,
	type AtomSymbol,
	type Effect,
	type Read,
	type Write,
} from './store'

export type MachineAtom<E, R> = AtomSymbol<R, Sendable<E>> & {
	can: AtomFamily<boolean, Sendable<E>, never>
	next: AtomFamily<R, Sendable<E>, never>
}

/**
 * Creates a writable store symbol backed by a state-machine transition.
 */
export function coreMachineAtom<E, S, R = S>(
	init: Init<S>,
	transition: (event: Tags<E>, state: S, read: Read, write: Write) => S,
	opts?: {
		result?: (state: S, read: Read) => R
		factory?: (value: S) => AtomSymbol<S, any>
		effect?: Effect<R, Sendable<E>>
	},
): MachineAtom<E, R> {
	const result = opts?.result ?? (id as (state: S, read: Read) => R)
	const factory: (value: S) => AtomSymbol<S, any> = opts?.factory ?? primitive
	const state = factory(fromInit(init))
	const ignoreWrite: Write = () => {}
	const machine = derived<R, Sendable<E>>(
		(read) => result(read(state), read),
		(read, write, event: Sendable<E>) => {
			const last = read(state)
			const next = transition(fromSendable(event), last, read, write)
			write(state, next)
		},
		opts?.effect,
	) as MachineAtom<E, R>

	machine.can = family<boolean, Sendable<E>, never>(
		(event) =>
			derived<boolean, never>((read) => {
				let dirty = false
				const last = read(state)
				const markDirty: Write = () => {
					dirty = true
				}
				const next = transition(fromSendable(event), last, read, markDirty)
				return dirty || !Object.is(next, last)
			}, noop),
		{ TTL: TRANSIENT },
	)
	machine.next = family<R, Sendable<E>, never>(
		(event) =>
			derived<R, never>(
				(read) =>
					result(
						transition(fromSendable(event), read(state), read, ignoreWrite),
						read,
					),
				noop,
			),
		{ TTL: TRANSIENT },
	)

	return machine
}
