import { fromInit, id, type Init } from '../functions'
import { fromSendable, type Sendable, type Tags } from '../tags'
import {
	derivedAtom,
	atomFamily,
	primitiveAtom,
	TRANSIENT,
	type AtomFamily,
	type AtomSymbol,
	type Effect,
	type Read,
	type Write,
} from './store'

export type MachineAtom<E, R> = AtomSymbol<R, Sendable<E>> & {
	can: AtomFamily<boolean, Sendable<E>, void>
	next: AtomFamily<R, Sendable<E>, void>
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
		effect?: Effect<R>
	},
): MachineAtom<E, R> {
	const result = opts?.result ?? (id as (state: S, read: Read) => R)
	const factory: (value: S) => AtomSymbol<S, any> =
		opts?.factory ?? primitiveAtom
	const state = factory(fromInit(init))
	const ignoreWrite: Write = () => {}
	const machine = derivedAtom<R, Sendable<E>>(
		(read) => result(read(state), read),
		(read, write, event: Sendable<E>) => {
			const last = read(state)
			const next = transition(fromSendable(event), last, read, write)
			write(state, next)
		},
		{ effect: opts?.effect },
	) as MachineAtom<E, R>

	machine.can = atomFamily<boolean, Sendable<E>, void>(
		(event) =>
			derivedAtom<boolean, void>(
				(read) => {
					let dirty = false
					const last = read(state)
					const markDirty: Write = () => {
						dirty = true
					}
					const next = transition(fromSendable(event), last, read, markDirty)
					return dirty || !Object.is(next, last)
				},
				(_read, write) => write(machine, event),
			),
		{ TTL: TRANSIENT },
	)
	machine.next = atomFamily<R, Sendable<E>, void>(
		(event) =>
			derivedAtom<R, void>(
				(read) =>
					result(
						transition(fromSendable(event), read(state), read, ignoreWrite),
						read,
					),
				(_read, write) => write(machine, event),
			),
		{ TTL: TRANSIENT },
	)

	return machine
}
