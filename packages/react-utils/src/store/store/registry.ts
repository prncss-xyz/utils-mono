import { exhaustive, fromInit, isoAssert } from '../../functions'
import { type AtomFamily, type AtomSymbol, type EffectAtom } from '../atoms'
import { createLinks, consumerCount, clearDependencies } from './graph'
import { type StoreState, queueEviction, publishChange } from './state'
import { type FamilySlot, type FamilyStorage, type Instance } from './types'

export function getInstance<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	key?: Key,
): Instance<S> {
	isoAssert(
		symbol.type === 'primitive' ||
			symbol.type === 'derived' ||
			symbol.type === 'family',
		'effect atoms have no value',
	)
	if (symbol.type === 'family') return getFamilyInstance(state, symbol, key!)
	let res = state.instances.get(symbol) as Instance<S> | undefined
	if (res === undefined) {
		res = createInstance(state, symbol)
		state.instances.set(symbol, res)
	}
	return res
}

export function getEffectInstance(
	state: StoreState,
	symbol: EffectAtom,
): Instance<any> {
	isoAssert(symbol.type === 'effect', 'mountEffect requires an effect atom')
	let instance = state.instances.get(symbol)
	if (!instance) {
		instance = createInstance(state, symbol)
		state.instances.set(symbol, instance)
	}
	return instance
}

function getFamilyInstance<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args>,
	key: Key,
): Instance<S> {
	if (symbol.retention.type === 'transient')
		return createFreshInstance(state, symbol, key)
	const { lookup } = symbol
	switch (lookup.type) {
		case 'hash': {
			const storage = getFamilyStorage(state, symbol, () => ({
				type: 'hash',
				map: new Map(),
			}))
			isoAssert(storage.type === 'hash')
			const { map } = storage
			const hashedKey = lookup.hash(key)
			return (
				map.get(hashedKey) ??
				createFamilyInstance(state, symbol, key, (instance) => {
					map.set(hashedKey, instance)
					return { type: 'hash', map, hashedKey }
				})
			)
		}
		case 'eq': {
			const storage = getFamilyStorage(state, symbol, () => ({
				type: 'eq',
				pairs: [],
			}))
			isoAssert(storage.type === 'eq')
			const { pairs } = storage
			return (
				pairs.find(([k]) => lookup.eq(k, key))?.[1] ??
				createFamilyInstance(state, symbol, key, (instance) => {
					pairs.push([key, instance])
					return { type: 'eq', pairs }
				})
			)
		}
		default:
			return exhaustive(lookup)
	}
}

function getFamilyStorage<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args>,
	init: () => FamilyStorage<S, Key>,
): FamilyStorage<S, Key> {
	let storage = state.families.get(symbol) as FamilyStorage<S, Key> | undefined
	if (storage === undefined) {
		storage = init()
		state.families.set(symbol, storage)
	}
	return storage
}

function createFamilyInstance<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args>,
	key: Key,
	register: (instance: Instance<S>) => FamilySlot,
): Instance<S> {
	const instance = createFreshInstance(state, symbol, key)
	const slot = register(instance)
	const { retention } = symbol
	isoAssert(retention.type !== 'transient')
	switch (retention.type) {
		case 'immediate':
		case 'timed':
			instance.familyEntry = { ...slot, retention }
			queueEviction(state, instance)
			break
		case 'permanent':
			break
		default:
			return exhaustive(retention)
	}
	return instance
}

function createFreshInstance<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args>,
	key: Key,
): Instance<S> {
	const created = symbol.create(key)
	isoAssert(
		!state.instances.has(created),
		'atomFamily create must return a fresh symbol on every call',
	)
	const instance = createInstance(state, created)
	state.instances.set(created, instance)
	return instance
}

function createInstance<S, Args extends unknown[]>(
	_state: StoreState,
	symbol: AtomSymbol<S, Args> | EffectAtom,
): Instance<S> {
	return {
		handle: undefined,
		symbol,
		familyEntry: undefined,
		familyRemovalTimeout: undefined,
		freshness:
			symbol.type === 'derived'
				? { type: 'dirty' }
				: { type: 'clean', validatedAt: -1 },
		value:
			symbol.type === 'primitive'
				? fromInit(symbol.getter)
				: (undefined as any),
		effectLifecycle: undefined,
		mountLifecycle: undefined,
		version: 0,
		...createLinks(),
		subscriptions: new Map(),
		mountCount: 0,
	}
}

export function evict<S>(state: StoreState, instance: Instance<S>) {
	const entry = instance.familyEntry
	isoAssert(entry)
	instance.familyEntry = undefined
	switch (entry.type) {
		case 'hash': {
			isoAssert(entry.map.get(entry.hashedKey) === instance)
			entry.map.delete(entry.hashedKey)
			break
		}
		case 'eq': {
			const index = entry.pairs.findIndex(([, value]) => value === instance)
			isoAssert(index !== -1)
			entry.pairs.splice(index, 1)
			break
		}
		default:
			return exhaustive(entry)
	}
	isoAssert(
		consumerCount(instance) === 0,
		'evicting an instance with dependants',
	)
	publishChange(state, instance)
	clearDependencies(instance)
	if (instance.symbol.type === 'derived') instance.freshness = { type: 'dirty' }
}
