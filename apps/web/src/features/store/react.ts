import { useContext, useSyncExternalStore } from 'react'

import type { Create } from './store'
import { StoreCtx } from './storeCtx'

export function useAtomValue<V, T, H>(atom: Create<V, T, H>, hash: H) {
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

export function useSetAtom<V, T, H>(atom: Create<V, T, H>, hash: H) {
	const store = useContext(StoreCtx)
	const instance = store.get(atom, hash)
	return instance.send.bind(instance)
}

export function useAtom<V, T, H>(atom: Create<V, T, H>, hash: H) {
	return [useAtomValue(atom, hash), useSetAtom(atom, hash)] as const
}
