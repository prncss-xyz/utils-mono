import { use, useEffect, useSyncExternalStore } from 'react'

import { isPromise } from './functions'
import type { Store } from './store'

export function useStoreValue<Value, Args extends any[], Result>(
	store: Store<Promise<Value> | Value, Args, Result>,
) {
	const res = useSyncExternalStore(
		store.subscribe.bind(store),
		store.peek.bind(store),
	)
	return isPromise(res) ? use(res) : res
}

export function setStore<Value, Args extends any[], Result>(
	store: Store<Promise<Value> | Value, Args, Result>,
) {
	return store.send.bind(store)
}

export function useStoreOnChange<Value, Args extends any[], Result>(
	store: Store<Value, Args, Result>,
	onChange: (value: Value) => void,
) {
	useEffect(
		() => store.subscribe(() => onChange(store.peek())),
		[onChange, store],
	)
}

export function useStore<Value, Args extends any[], Result>(
	store: Store<Value, Args, Result>,
) {
	return [useStoreValue(store), store.send.bind(store)] as const
}
