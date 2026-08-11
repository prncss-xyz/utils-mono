import { useContext, useSyncExternalStore } from 'react'

import type { Primitive } from './primitive'
import { StoreCtx } from './storeCtx'

export function useAtomValue<Value>(atom: Primitive<Value>) {
	const store = useContext(StoreCtx)
	const instance = store.get(atom)
	const res = useSyncExternalStore(
		instance.subscribe.bind(instance),
		instance.peek.bind(instance),
	)
	return res
}

export function useSetAtom<Value>(atom: Primitive<Value>) {
	const store = useContext(StoreCtx)
	const instance = store.get(atom)
	return instance.send.bind(instance)
}

export function useAtom<Value>(atom: Primitive<Value>) {
	return [useAtomValue(atom), useSetAtom(atom)] as const
}
