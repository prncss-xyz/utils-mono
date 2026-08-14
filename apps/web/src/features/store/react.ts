import { useContext, useSyncExternalStore } from 'react'

import type { Atom } from './store'
import { StoreCtx } from './storeCtx'

export function useAtomValue<V, H, Args extends any[], R>(
	atom: Atom<V, H, Args, R>,
	hash: H,
): V {
	const store = useContext(StoreCtx)
	const instance = atom.instance(store, hash)
	const peek = instance.peek.bind(instance)
	const res = useSyncExternalStore(
		instance.subscribe.bind(instance),
		peek,
		peek,
	)
	return res
}

function useSetAtom<V, H, Args extends any[], R>(
	atom: Atom<V, H, Args, R>,
	hash: H,
) {
	const store = useContext(StoreCtx)
	const instance = atom.instance(store, hash)
	return instance.send.bind(instance)
}

export function useAtom<V, H, Args extends any[], R>(
	atom: Atom<V, H, Args, R>,
	hash: H,
) {
	return [useAtomValue(atom, hash), useSetAtom(atom, hash)] as const
}
