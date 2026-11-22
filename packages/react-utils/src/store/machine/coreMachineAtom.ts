import { fromInit, id, isReset, type Init, type Reset } from '../../functions'
import { tag, type Tags } from '../../tags'
import {
	atomFamily,
	TRANSIENT,
	type AtomFamily,
	primitiveAtom,
	derivedAtom,
	type AtomSymbol,
	effectAtom,
	type Read,
	type Write,
} from '../store'
import type { MachineEffect } from './machineEffect'

type EventArgs<P> = [P] extends [void] ? [] : [payload: P]

/**
 * Write-only atom dispatching one event type. `can` and `next` preview the
 * transition for a payload (omitted for void events), and writing to
 * either dispatches it.
 */
export type EventAtom<R, P> = AtomSymbol<never, EventArgs<P>> & {
	can: AtomFamily<boolean, P, []>
	next: AtomFamily<R, P, []>
}

export type MachineEvents<E, R> = {
	readonly [K in keyof E]-?: EventAtom<R, E[K]>
}

/**
 * The state atom, writable with `RESET`, and one event atom per event type.
 */
export type MachineAtom<E, R> = readonly [
	AtomSymbol<R, [Reset]>,
	MachineEvents<E, R>,
]

/**
 * Creates a state atom backed by a state-machine transition, and event atoms
 * dispatching to it.
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
		effect?: MachineEffect<R>
	},
): MachineAtom<E, R> {
	const result = opts?.result ?? (id as (state: S, read: Read) => R)
	const factory: (value: S) => AtomSymbol<S, any> =
		opts?.factory ?? primitiveAtom
	const state = factory(fromInit(init))
	const advance = (
		event: Tags<E> | Reset,
		last: S,
		read: Read,
		write: Write,
	) => {
		const next = transition(event, last, read, write)
		return isReset(next) ? fromInit(init) : next
	}
	const dispatch = (read: Read, write: Write, event: Tags<E> | Reset) =>
		write(state, advance(event, read(state), read, write))
	const preview = (event: Tags<E>, read: Read) => {
		const last = read(state)
		let dirty = false
		const markDirty: Write = () => {
			dirty = true
		}
		const next = advance(event, last, read, markDirty)
		return { next, changed: dirty || !Object.is(next, last) }
	}
	const output = derivedAtom(
		(read) => result(read(state), read),
		(read, write, reset: Reset) => dispatch(read, write, reset),
		{
			onMount: opts?.effect
				? (_read, _write, mountEffect) => {
						const effect = opts.effect!
						let initialized = false
						let active = true
						let cleanup: void | (() => void)
						const clean = () => {
							const previous = cleanup
							cleanup = undefined
							previous?.()
						}
						mountEffect(
							effectAtom(
								(read) => result(read(state), read),
								(next, last, read, write) => {
									if (initialized && Object.is(next, last)) return
									clean()
									if (!active) return
									const nextCleanup = effect(next, last, read, write)
									if (active) cleanup = nextCleanup
									else nextCleanup?.()
									initialized = true
								},
							),
						)
						return () => {
							active = false
							clean()
						}
					}
				: undefined,
		},
	)
	const eventAtom = (type: string) => {
		const toEvent = (payload: unknown) => tag(type, payload) as Tags<E>
		const previewFamily = <V>(
			project: (p: ReturnType<typeof preview>, read: Read) => V,
		) =>
			atomFamily<V, unknown, []>(
				(payload) =>
					derivedAtom(
						(read) => project(preview(toEvent(payload), read), read),
						(read, write) => dispatch(read, write, toEvent(payload)),
					),
				{ TTL: TRANSIENT },
			)
		return Object.assign(
			derivedAtom(null, (read, write, payload?: unknown) =>
				dispatch(read, write, toEvent(payload)),
			),
			{
				can: previewFamily(({ changed }) => changed),
				next: previewFamily(({ next }, read) => result(next, read)),
			},
		)
	}
	const cache = new Map<string, ReturnType<typeof eventAtom>>()
	const events = new Proxy(
		{},
		{
			get: (_target, type) => {
				if (typeof type !== 'string') return undefined
				let atom = cache.get(type)
				if (!atom) {
					atom = eventAtom(type)
					cache.set(type, atom)
				}
				return atom
			},
		},
	) as MachineEvents<E, R>
	return [output, events]
}
