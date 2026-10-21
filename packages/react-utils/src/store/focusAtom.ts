import { isFunction, isoAssert } from '../functions'
import { derivedAtom, type AtomSymbol } from './store'

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

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
	},
): AtomSymbol<Focused<Source, Value>, Value | Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover?: never
	},
): AtomSymbol<Focused<Source, Value>, Value | Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
		setter?: never
	},
): AtomSymbol<Focused<Source, Value>, Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		setter?: never
		modifier?: never
		remover?: never
	},
): AtomSymbol<Focused<Source, Value>, never>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
	},
): AtomSymbol<never, Value | Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover?: never
	},
): AtomSymbol<never, Value>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter?: never
		modifier: Modifier<Source, Event, Value>
		remover?: never
		setter?: never
	},
): AtomSymbol<never, Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
	},
): AtomSymbol<Focused<Source, Value>, Value | Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover: Remover<Source, Event>
	},
): AtomSymbol<Focused<Source, Value>, Value | Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
		setter?: never
	},
): AtomSymbol<Focused<Source, Value>, Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter: Getter<Source, Value>
		setter?: never
		modifier?: never
		remover: Remover<Source, Event>
	},
): AtomSymbol<Focused<Source, Value>, null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
	},
): AtomSymbol<never, Value | Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover: Remover<Source, Event>
	},
): AtomSymbol<never, Value | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter?: never
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
		setter?: never
	},
): AtomSymbol<never, Modify<Value> | null | undefined>
export function focusAtom<Source, Event>(
	sourceAtom: AtomSymbol<Source, Event>,
	opts: {
		getter?: never
		setter?: never
		modifier?: never
		remover: Remover<Source, Event>
	},
): AtomSymbol<never, null | undefined>
export function focusAtom(sourceAtom: any, opts: any): any {
	const { getter, setter, modifier, remover } = opts
	return derivedAtom(
		(read) => {
			isoAssert(getter)
			const source = read(sourceAtom)
			return source == null ? (source as null | undefined) : getter(source)
		},
		(read, write, update: any) => {
			const source = read(sourceAtom)
			if (source == null) return
			if (update == null) {
				isoAssert(remover)
				write(sourceAtom, remover(source))
				return
			}
			const current = source
			if (isFunction(update)) {
				if (modifier) {
					write(sourceAtom, modifier(update, current))
					return
				}
				isoAssert(setter)
				isoAssert(getter)
				write(sourceAtom, setter(update(getter(current)), current))
				return
			}
			isoAssert(setter)
			write(sourceAtom, setter(update, current))
		},
	)
}
