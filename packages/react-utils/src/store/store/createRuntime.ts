import {
	type AtomFamily,
	type AtomSymbol,
	type Hydrate,
	type Read,
	type Resolve,
	type Subscribe,
	type Store,
	type ResolvedAtom,
	type Write,
} from '../atoms'
import { peekInstance, retain, release } from './engine'
import { flush } from './flush'
import { getInstance, getEffectInstance } from './registry'
import { type StoreState, assertOutsideGetter, createState } from './state'
import { type Instance } from './types'
import { readPending, sendInstance, dispatch } from './write'

export function createRuntime(hydrate: Hydrate = []): {
	store: Store
	state: StoreState
} {
	const state: StoreState = createState({
		read: ((symbol, key) => {
			assertOutsideGetter(state)
			return peekInstance(state, getInstance(state, symbol, key))
		}) as Read,
		write: ((
			symbol: AtomFamily<any, any, any> | AtomSymbol<any, any>,
			...rest: unknown[]
		) => {
			assertOutsideGetter(state)
			dispatch(state, symbol, rest)
		}) as Write,
		readPending: ((symbol, key) => readPending(state, symbol, key)) as Read,
		scheduleFlush: () => queueMicrotask(() => flush(state)),
	})
	for (const [symbol, ...rest] of hydrate)
		dispatch(
			state,
			symbol as AtomSymbol<any, any> | AtomFamily<any, any, any>,
			rest,
		)
	if (state.tasks) flush(state)
	state.hydrating = false
	const store: Store = {
		mountEffect: (effect) => {
			assertOutsideGetter(state)
			const instance = getEffectInstance(state, effect)
			retain(state, instance)
			let active = true
			return () => {
				if (!active) return
				active = false
				release(state, instance)
			}
		},
		peek: state.read,
		send: state.write,
		resolve: ((symbol, key) => resolve(state, symbol, key)) as Resolve,
		subscribe: ((symbol, keyOrNotify, notify) =>
			subscribe(state, symbol, keyOrNotify, notify)) as Subscribe,
	}
	return { store, state }
}

function subscribeInstance<S>(
	state: StoreState,
	instance: Instance<S>,
	notify: () => void,
) {
	assertOutsideGetter(state)
	let registration = instance.subscriptions.get(notify)
	if (!registration) {
		registration = { references: 0 }
		instance.subscriptions.set(notify, registration)
	}
	registration.references++
	retain(state, instance)
	let active = true
	return () => {
		if (!active) return
		active = false
		if (--registration.references === 0) instance.subscriptions.delete(notify)
		release(state, instance)
	}
}

function resolve<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	key?: Key,
): ResolvedAtom<S, Args> {
	const instance = getInstance(state, symbol, key)
	if (instance.handle) return instance.handle
	if (symbol.type !== 'family' || symbol.retention.type === 'transient') {
		return (instance.handle = {
			peek: () => {
				assertOutsideGetter(state)
				return peekInstance(state, instance)
			},
			send: (...args) => {
				assertOutsideGetter(state)
				sendInstance(state, instance, args)
			},
			subscribe: (notify) => subscribeInstance(state, instance, notify),
		})
	}
	return (instance.handle = {
		peek: () => {
			assertOutsideGetter(state)
			return peekInstance(state, getInstance(state, symbol, key))
		},
		send: (...args) => {
			assertOutsideGetter(state)
			sendInstance(state, getInstance(state, symbol, key), args)
		},
		subscribe: (notify) =>
			subscribeInstance(state, getInstance(state, symbol, key), notify),
	})
}

function subscribe<S, Key, Args extends unknown[]>(
	state: StoreState,
	symbol: AtomFamily<S, Key, Args> | AtomSymbol<S, Args>,
	keyOrNotify: Key | (() => void),
	notify?: () => void,
): () => void {
	const instance = getInstance(state, symbol, keyOrNotify as Key)
	const callback =
		symbol.type === 'family' ? notify! : (keyOrNotify as () => void)
	return subscribeInstance(state, instance, callback)
}
