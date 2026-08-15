import { useContext, useSyncExternalStore } from 'react'

import type { Atom, KeyArg } from './store'
import { StoreCtx } from './storeCtx'

export function useAtomValue<V, K, Args extends any[], R>(
	atom: Atom<V, K, Args, R>,
	...key: KeyArg<K>
): V {
	const store = useContext(StoreCtx)
	const instance = atom.instance(store, key[0] as K)
	const peek = instance.peek.bind(instance)
	const res = useSyncExternalStore(
		instance.subscribe.bind(instance),
		peek,
		peek,
	)
	return res
}

function useSetAtom<V, K, Args extends any[], R>(
	atom: Atom<V, K, Args, R>,
	...key: KeyArg<K>
) {
	const store = useContext(StoreCtx)
	const instance = atom.instance(store, key[0] as K)
	return instance.send.bind(instance)
}

export function useAtom<V, K, Args extends any[], R>(
	atom: Atom<V, K, Args, R>,
	...key: KeyArg<K>
) {
	return [useAtomValue(atom, ...key), useSetAtom(atom, ...key)] as const
}
