import {
	exhaustive,
	fromInit,
	isFunction,
	isoAssert,
	isReset,
} from '../../functions'
import { noread, type AtomFamily, type AtomSymbol } from '../atoms'
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
	if (instance.symbol.type === 'primitive')
		return pending.has(instance)
			? pending.get(instance)
			: peekInstance(state, instance)
	isoAssert(!state.pendingEvaluations.has(instance), 'cyclic atom dependency')
	state.pendingEvaluations.add(instance)
	if (state.instrumentation)
		countOperation(state, 'pendingGetters', instance.symbol)
	const value = instance.symbol.getter(state.readPending)
	state.pendingEvaluations.delete(instance)
	return value
}

export function sendInstance<S>(
	state: StoreState,
	instance: Instance<S>,
	args: readonly unknown[],
) {
	const { symbol } = instance
	if (symbol.type === 'primitive' || symbol.getter !== noread)
		cancelEviction(state, instance)
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
	const key = symbol.type === 'family' ? rest[0] : undefined
	const args = symbol.type === 'family' ? rest.slice(1) : rest
	sendInstance(state, getInstance(state, symbol, key), args)
}
