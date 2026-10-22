import { isFunction, isoAssert } from '../functions'
import {
	atomFamily,
	derivedAtom,
	TRANSIENT,
	type AtomFamily,
	type AtomSymbol,
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

type FocusAtom<Value, Event, SourceAtom> = AtomSymbol<Value, Event> &
	(SourceAtom extends { can: AtomFamily<boolean, any, void> }
		? { can: AtomFamily<boolean, Event, void> }
		: {})

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
	if (!sourceAtom.can) return focused
	return Object.assign(focused, {
		can: atomFamily<boolean, any, void>(
			(update) =>
				derivedAtom(
					(read) => {
						const source = read(sourceAtom)
						return source == null
							? false
							: read(sourceAtom.can, eventFor(source, update))
					},
					(_read, write) => write(focused, update),
				),
			{ TTL: TRANSIENT },
		),
	})
}
