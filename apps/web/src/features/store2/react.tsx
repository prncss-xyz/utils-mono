'use client'
import { createContext, useContext, useSyncExternalStore } from 'react'

import { Store, type AtomSymbol } from './store'

const StoreCtx = createContext(new Store())

export function StoreProvider({ children }: { children: React.ReactNode }) {
	return <StoreCtx.Provider value={new Store()}>{children}</StoreCtx.Provider>
}

export function useAtomValue<V>(
	atom: AtomSymbol<V, any> | AtomSymbol<V, never>,
): V {
	const store = useContext(StoreCtx)
	const peek = () => store.peek(atom)
	const res = useSyncExternalStore(
		(notify: () => void) => store.subscribe(atom, notify),
		peek,
		peek,
	)
	return res
}

export function useSetAtom<V, E>(atom: AtomSymbol<V, E>) {
	const store = useContext(StoreCtx)
	return (e: E) => store.send(atom, e)
}

export function useAtom<V, E>(atom: AtomSymbol<V, E>) {
	return [useAtomValue(atom), useSetAtom(atom)] as const
}
