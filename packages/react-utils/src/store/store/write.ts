import {
	exhaustive,
	fromInit,
	isFunction,
	isoAssert,
	isReset,
} from '../../functions'
import { noread, type AtomFamily, type AtomSymbol, type Read } from '../atoms'
import { peekInstance } from './engine'
import { getInstance } from './registry'
import {
	type StoreState,
	cancelEviction,
	countOperation,
	pendingWrites,
} from './state'
import { type Instance } from './types'

/** Setters read the pending state; public reads keep the committed snapshot. */
export function readPending<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	key?: Key,
): S {
	const instance = getInstance(state, symbol, key)
	const pending = pendingWrites(state)
	if (!pending?.size) return peekInstance(state, instance)
	const scope: PendingRead = {
		pending,
		memo: new Map(),
		read: ((target, targetKey) =>
			readPendingInstance(
				state,
				getInstance(state, target, targetKey),
				scope,
			)) as Read,
	}
	return readPendingInstance(state, instance, scope)
}

/**
 * One pending read: the pending writes it sees, the derived values it has
 * computed by resolved instance, and the `read` its getters receive. It is
 * shared by the read's nested reads and dropped when the read returns.
 */
type PendingRead = {
	pending: Map<Instance<any>, any>
	memo: Map<Instance<any>, unknown>
	read: Read
}

/**
 * An instance is memoized only once its getter returns, so a read that
 * re-enters an instance still under evaluation is a cycle.
 */
function readPendingInstance<S>(
	state: StoreState,
	instance: Instance<S>,
	{ pending, memo, read }: PendingRead,
): S {
	if (instance.symbol.type === 'primitive')
		return pending.has(instance)
			? pending.get(instance)
			: peekInstance(state, instance)
	isoAssert(instance.symbol.type === 'derived')
	isoAssert(!state.pendingEvaluations.has(instance), 'cyclic atom dependency')
	if (memo.has(instance)) return memo.get(instance) as S
	state.pendingEvaluations.add(instance)
	if (state.instrumentation)
		countOperation(state, 'pendingGetters', instance.symbol)
	const value = instance.symbol.getter(read)
	state.pendingEvaluations.delete(instance)
	memo.set(instance, value)
	return value
}

export function sendInstance<S>(
	state: StoreState,
	instance: Instance<S>,
	args: readonly unknown[],
) {
	const { symbol } = instance
	isoAssert(symbol.type !== 'effect', 'effect atoms have no value')
	if (symbol.getter !== noread) cancelEviction(state, instance)
	switch (symbol.type) {
		case 'primitive': {
			const event = args[0]
			const primitives = pendingWrites(state, true)
			const next = isFunction(event)
				? event(readPending(state, symbol))
				: isReset(event)
					? fromInit(symbol.getter)
					: event
			primitives.set(instance, next)
			return
		}
		case 'derived': {
			symbol.setter(state.readPending, state.write, ...args)
			return
		}
		default:
			return exhaustive(symbol)
	}
}

export function dispatch(
	state: StoreState,
	symbol: AtomFamily<any, any, any> | AtomSymbol<any, any>,
	rest: readonly unknown[],
) {
	const key = rest[0]
	const args = symbol.type === 'family' ? rest.slice(1) : rest
	sendInstance(state, getInstance(state, symbol, key), args)
}
