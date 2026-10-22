import { isFunction, isoAssert } from '../functions'
import {
	atomFamily,
	derivedAtom,
	TRANSIENT,
	type AtomFamily,
	type AtomSymbol,
	type Read,
	type Write,
	type Effect,
} from './store'

type Modify<Value> = (value: Value) => Value
type Focused<Source, Value> = Value | Extract<Source, null | undefined>
type NonNullish<Source> = NonNullable<Source>
type Getter<Source, Value> = (source: NonNullish<Source>) => Value
type Setter<Source, Event, Value> = (
	value: Value,
	source: NonNullish<Source>,
) => Event
type Remover<Source, Event> = (source: NonNullish<Source>) => Event
type Modifier<Source, Event, Value> = (
	modify: Modify<Value>,
	source: NonNullish<Source>,
) => Event

export type PreviewAtom<Value, Event> = AtomSymbol<Value, Event> & {
	can: AtomFamily<boolean, Event, void>
	next: AtomFamily<Value, Event, void>
}

type FocusAtom<Value, Event, SourceAtom> = SourceAtom extends {
	can: AtomFamily<boolean, any, void>
	next: AtomFamily<any, any, void>
}
	? PreviewAtom<Value, Event>
	: AtomSymbol<Value, Event>

/** Focuses a state-bearing atom through a transition, with write-free previews. */
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Source>,
	opts: {
		getter: (source: Source, read: Read) => Value
		transition: (
			event: Event,
			source: Source,
			read: Read,
			write: Write,
		) => Source
		effect?: Effect<Value>
	},
): PreviewAtom<Value, Event>
/**
 * Focuses reads and updates on part of a source atom.
 * Sources with `can` and `next` also expose focused preview families; sending
 * to either family dispatches the focused update. Nullish sources ignore updates.
 */
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
	},
): FocusAtom<Focused<Source, Value>, Value | Modify<Value>, SourceAtom>
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover?: never
	},
): FocusAtom<Focused<Source, Value>, Value | Modify<Value>, SourceAtom>
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
		setter?: never
	},
): FocusAtom<Focused<Source, Value>, Modify<Value>, SourceAtom>
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		setter?: never
		modifier?: never
		remover?: never
	},
): FocusAtom<Focused<Source, Value>, never, SourceAtom>
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
	},
): FocusAtom<never, Value | Modify<Value>, SourceAtom>
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover?: never
	},
): FocusAtom<never, Value, SourceAtom>
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter?: never
		modifier: Modifier<Source, Event, Value>
		remover?: never
		setter?: never
	},
): FocusAtom<never, Modify<Value>, SourceAtom>
export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
	},
): FocusAtom<
	Focused<Source, Value>,
	Value | Modify<Value> | null | undefined,
	SourceAtom
>

export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<
	Focused<Source, Value>,
	Value | Modify<Value> | null | undefined,
	SourceAtom
>

export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
		setter?: never
	},
): FocusAtom<
	Focused<Source, Value>,
	Modify<Value> | null | undefined,
	SourceAtom
>

export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter: Getter<Source, Value>
		setter?: never
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<Focused<Source, Value>, null | undefined, SourceAtom>

export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
	},
): FocusAtom<never, Value | Modify<Value> | null | undefined, SourceAtom>

export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<never, Value | null | undefined, SourceAtom>

export function focusAtom<Source, Event, Value, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter?: never
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
		setter?: never
	},
): FocusAtom<never, Modify<Value> | null | undefined, SourceAtom>
export function focusAtom<Source, Event, SourceAtom extends object = {}>(
	sourceAtom: AtomSymbol<Source, Event> & SourceAtom,
	opts: {
		getter?: never
		setter?: never
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<never, null | undefined, SourceAtom>
export function focusAtom(sourceAtom: any, opts: any): any {
	if (opts.transition) {
		const { getter, transition } = opts
		const focused = derivedAtom(
			(read) => getter(read(sourceAtom), read),
			(read, write, event: any) => {
				write(sourceAtom, transition(event, read(sourceAtom), read, write))
			},
			{ effect: opts.effect },
		)
		const preview = (event: any, read: Read) => {
			const last = read(sourceAtom)
			let dirty = false
			const markDirty: Write = () => {
				dirty = true
			}
			const next = transition(event, last, read, markDirty)
			return { next, changed: dirty || !Object.is(next, last) }
		}
		return Object.assign(focused, {
			can: atomFamily<boolean, any, void>(
				(event) =>
					derivedAtom(
						(read) => preview(event, read).changed,
						(_read, write) => write(focused, event),
					),
				{ TTL: TRANSIENT },
			),
			next: atomFamily<any, any, void>(
				(event) =>
					derivedAtom(
						(read) => getter(preview(event, read).next, read),
						(_read, write) => write(focused, event),
					),
				{ TTL: TRANSIENT },
			),
		})
	}
	const { getter, setter, modifier, remover } = opts
	const project = (source: any) => {
		isoAssert(getter)
		return source == null ? source : getter(source)
	}
	const eventFor = (source: any, update: any) => {
		if (update == null) {
			isoAssert(remover)
			return remover(source)
		}
		if (isFunction(update)) {
			if (modifier) return modifier(update, source)
			isoAssert(setter)
			isoAssert(getter)
			return setter(update(getter(source)), source)
		}
		isoAssert(setter)
		return setter(update, source)
	}
	const focused = derivedAtom(
		(read) => project(read(sourceAtom)),
		(read, write, update: any) => {
			const source = read(sourceAtom)
			if (source != null) write(sourceAtom, eventFor(source, update))
		},
	)
	if (!sourceAtom.can || !sourceAtom.next) return focused
	const preview = (family: 'can' | 'next', update: any, read: Read) => {
		const source = read(sourceAtom)
		if (source == null) return family === 'can' ? false : project(source)
		const event = eventFor(source, update)
		return family === 'can'
			? read(sourceAtom.can, event)
			: project(read(sourceAtom.next, event))
	}
	return Object.assign(focused, {
		can: atomFamily<boolean, any, void>(
			(update) =>
				derivedAtom(
					(read) => preview('can', update, read),
					(_read, write) => write(focused, update),
				),
			{ TTL: TRANSIENT },
		),
		next: atomFamily<any, any, void>(
			(update) =>
				derivedAtom(
					(read) => preview('next', update, read),
					(_read, write) => write(focused, update),
				),
			{ TTL: TRANSIENT },
		),
	})
}
