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
	dropPendingValues,
	pendingWrites,
} from './state'
import { type Instance } from './types'

/**
 * Setters read the pending state; public reads keep the committed snapshot.
 * A derived value is stored in `state.pendingValues` only once its getter
 * returns, so a read that re-enters an instance still under evaluation is a
 * cycle. Getters cannot write, so the cache cannot be dropped while one runs.
 */
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
	isoAssert(instance.symbol.type === 'derived')
	isoAssert(!state.pendingEvaluations.has(instance), 'cyclic atom dependency')
	const values = (state.pendingValues ??= new Map())
	if (values.has(instance)) return values.get(instance) as S
	state.pendingEvaluations.add(instance)
	countOperation(state, 'pendingGetters', instance.symbol)
	state.evaluatingGetters++
	const value = instance.symbol.getter(state.readPending)
	state.evaluatingGetters--
	state.pendingEvaluations.delete(instance)
	values.set(instance, value)
	return value
}

export function sendInstance<S>(
	state: StoreState,
	instance: Instance<S>,
	args: readonly unknown[],
) {
	const { symbol } = instance
	isoAssert(symbol.type !== 'effect', 'effect atoms have no value')
	if (symbol.getter !== noread) {
		cancelEviction(state, instance)
		instance.familyEntry = undefined
	}
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
			dropPendingValues(state)
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
