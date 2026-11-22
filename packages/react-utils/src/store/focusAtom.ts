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

type FocusAtom<Value, Event> = AtomSymbol<
	Value,
	[Event] extends [never] ? never : [Event]
>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
	},
): FocusAtom<Focused<Source, Value>, Value | Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover?: never
	},
): FocusAtom<Focused<Source, Value>, Value | Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter: Getter<Source, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
		setter?: never
	},
): FocusAtom<Focused<Source, Value>, Modify<Value>>
export function focusAtom<Source, Args extends unknown[], Value>(
	sourceAtom: AtomSymbol<Source, Args>,
	opts: {
		getter: Getter<Source, Value>
		setter?: never
		modifier?: never
		remover?: never
	},
): FocusAtom<Focused<Source, Value>, never>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover?: never
	},
): FocusAtom<never, Value | Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover?: never
	},
): FocusAtom<never, Value>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter?: never
		modifier: Modifier<Source, Event, Value>
		remover?: never
		setter?: never
	},
): FocusAtom<never, Modify<Value>>
export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
	},
): FocusAtom<Focused<Source, Value>, Value | Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter: Getter<Source, Value>
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<Focused<Source, Value>, Value | Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter: Getter<Source, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
		setter?: never
	},
): FocusAtom<Focused<Source, Value>, Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter: Getter<Source, Value>
		setter?: never
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<Focused<Source, Value>, null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
	},
): FocusAtom<never, Value | Modify<Value> | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter?: never
		setter: Setter<Source, Event, Value>
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<never, Value | null | undefined>

export function focusAtom<Source, Event, Value>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter?: never
		modifier: Modifier<Source, Event, Value>
		remover: Remover<Source, Event>
		setter?: never
	},
): FocusAtom<never, Modify<Value> | null | undefined>
export function focusAtom<Source, Event>(
	sourceAtom: AtomSymbol<Source, [Event]>,
	opts: {
		getter?: never
		setter?: never
		modifier?: never
		remover: Remover<Source, Event>
	},
): FocusAtom<never, null | undefined>
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
	return derivedAtom(
		(read) => project(read(sourceAtom)),
		(read, write, update: any) => {
			const source = read(sourceAtom)
			if (source != null) write(sourceAtom, eventFor(source, update))
		},
	)
}
