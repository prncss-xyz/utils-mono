import { fromInit, id, isReset, type Init, type Reset } from '../functions'
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

export type MachineAtom<E, R> = AtomSymbol<R, Sendable<E> | Reset> & {
	can: AtomFamily<boolean, Sendable<E> | Reset, void>
	next: AtomFamily<R, Sendable<E> | Reset, void>
}

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
	const ignoreWrite: Write = () => {}
	const resolve = (value: S | Reset): S =>
		isReset(value) ? fromInit(init) : value
	const machine = derivedAtom<R, Sendable<E> | Reset>(
		(read) => result(read(state), read),
		(read, write, event: Sendable<E> | Reset) => {
			const last = read(state)
			const next = transition(
				isReset(event) ? event : fromSendable(event),
				last,
				read,
				write,
			)
			write(state, resolve(next))
		},
		{ effect: opts?.effect },
	) as MachineAtom<E, R>

	machine.can = atomFamily<boolean, Sendable<E> | Reset, void>(
		(event) =>
			derivedAtom<boolean, void>(
				(read) => {
					let dirty = false
					const last = read(state)
					const markDirty: Write = () => {
						dirty = true
					}
					const next = transition(
						isReset(event) ? event : fromSendable(event),
						last,
						read,
						markDirty,
					)
					return dirty || !Object.is(resolve(next), last)
				},
				(_read, write) => write(machine, event),
			),
		{ TTL: TRANSIENT },
	)
	machine.next = atomFamily<R, Sendable<E> | Reset, void>(
		(event) =>
			derivedAtom<R, void>(
				(read) =>
					result(
						resolve(
							transition(
								isReset(event) ? event : fromSendable(event),
								read(state),
								read,
								ignoreWrite,
							),
						),
						read,
					),
				(_read, write) => write(machine, event),
			),
		{ TTL: TRANSIENT },
	)

	return machine
}
