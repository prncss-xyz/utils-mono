import { fromInit, id, isReset, type Init, type Reset } from '../../functions'
import { fromSendable, type Sendable, type Tags } from '../../tags'
import {
	atomFamily,
	TRANSIENT,
	type AtomFamily,
	primitiveAtom,
	derivedAtom,
	type AtomSymbol,
	type Effect,
	type Read,
	type Write,
} from '../store'

export type PreviewAtom<Value, Args extends [unknown]> = AtomSymbol<
	Value,
	Args
> & {
	can: AtomFamily<boolean, Args[0], []>
	next: AtomFamily<Value, Args[0], []>
}

type Transition<State, Event> = (
	event: Event,
	state: State,
	read: Read,
	write: Write,
) => State

function preview<State, Event>(
	atom: AtomSymbol<State, any>,
	transition: Transition<State, Event>,
	event: Event,
	read: Read,
) {
	const last = read(atom)
	let dirty = false
	const markDirty: Write = () => {
		dirty = true
	}
	const next = transition(event, last, read, markDirty)
	return { next, changed: dirty || !Object.is(next, last) }
}

function canAtom<State, Event>(
	atom: AtomSymbol<State, any>,
	transition: Transition<State, Event>,
	dispatch: AtomSymbol<any, [Event]>,
) {
	return atomFamily<boolean, Event, []>(
		(event) =>
			derivedAtom(
				(read) => preview(atom, transition, event, read).changed,
				(_read, write) => write(dispatch, event),
			),
		{ TTL: TRANSIENT },
	)
}

function nextAtom<State, Event, Value>(
	atom: AtomSymbol<State, any>,
	transition: Transition<State, Event>,
	project: (state: State, read: Read) => Value,
	dispatch: AtomSymbol<any, [Event]>,
) {
	return atomFamily<Value, Event, []>(
		(event) =>
			derivedAtom(
				(read) => project(preview(atom, transition, event, read).next, read),
				(_read, write) => write(dispatch, event),
			),
		{ TTL: TRANSIENT },
	)
}

export type MachineAtom<E, R> = PreviewAtom<R, [Sendable<E> | Reset]>

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
	const advance = (
		event: Sendable<E> | Reset,
		last: S,
		read: Read,
		write: Write,
	) => {
		const next = transition(
			isReset(event) ? event : fromSendable(event),
			last,
			read,
			write,
		)
		return isReset(next) ? fromInit(init) : next
	}
	const output = derivedAtom(
		(read) => result(read(state), read),
		(read, write, event: Sendable<E> | Reset) =>
			write(state, advance(event, read(state), read, write)),
		{ effect: opts?.effect },
	)
	return Object.assign(output, {
		can: canAtom(state, advance, output),
		next: nextAtom(state, advance, result, output),
	})
}
