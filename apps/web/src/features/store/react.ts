import { useContext, useSyncExternalStore } from 'react'

import type { Atom } from './store'
import { StoreCtx } from './storeCtx'

export function useAtomValue<V, H>(atom: Atom<V, H>, hash: H): V {
	const store = useContext(StoreCtx)
	const instance = store.get(atom, hash)
	const peek = instance.peek.bind(instance)
	const res = useSyncExternalStore(
		instance.subscribe.bind(instance),
		peek,
		peek,
	)
	return res
}

export function useSetAtom<V, H>(atom: Atom<V, H>, hash: H) {
	const store = useContext(StoreCtx)
	const instance = store.get(atom, hash)
	return instance.send.bind(instance)
}

export function useAtom<V, H>(atom: Atom<V, H>, hash: H) {
	return [useAtomValue(atom, hash), useSetAtom(atom, hash)] as const
}
