'use client'
import { createContext, useContext, useSyncExternalStore } from 'react'

import { createStore, type AtomFamily, type AtomSymbol } from './store'

const StoreCtx = createContext(createStore())

export function StoreProvider({ children }: { children: React.ReactNode }) {
	return <StoreCtx.Provider value={createStore()}>{children}</StoreCtx.Provider>
}

function useAtomValueInternal<V, Key, E>(
	atom: AtomFamily<V, Key, E> | AtomSymbol<V, E>,
	key?: Key,
) {
	const store = useContext(StoreCtx)
	const peek = () =>
		atom.type === 'family' ? store.peek(atom, key!) : store.peek(atom)
	const subscribe = (notify: () => void) =>
		atom.type === 'family'
			? store.subscribe(atom, key!, notify)
			: store.subscribe(atom, notify)
	return useSyncExternalStore(subscribe, peek, peek)
}

export function useAtomValue<V, Key, E>(
	atom: AtomFamily<V, Key, E>,
	key: Key,
): V
export function useAtomValue<V, E>(atom: AtomSymbol<V, E>): V
export function useAtomValue<V, Key, E>(
	atom: AtomFamily<V, Key, E> | AtomSymbol<V, E>,
	key?: Key,
) {
	return useAtomValueInternal(atom, key)
}

function useSetAtomInternal<V, Key, E>(
	atom: AtomFamily<V, Key, E> | AtomSymbol<V, E>,
	key?: Key,
) {
	const store = useContext(StoreCtx)
	return (event: E) =>
		atom.type === 'family'
			? store.send(atom, key!, event)
			: store.send(atom, event)
}

export function useSetAtom<V, Key, E>(
	atom: AtomFamily<V, Key, E>,
	key: Key,
): (event: E) => void
export function useSetAtom<V, E>(atom: AtomSymbol<V, E>): (event: E) => void
export function useSetAtom<V, Key, E>(
	atom: AtomFamily<V, Key, E> | AtomSymbol<V, E>,
	key?: Key,
) {
	return useSetAtomInternal(atom, key)
}

export function useAtom<V, Key, E>(
	atom: AtomFamily<V, Key, E>,
	key: Key,
): readonly [V, (event: E) => void]
export function useAtom<V, E>(
	atom: AtomSymbol<V, E>,
): readonly [V, (event: E) => void]
export function useAtom<V, Key, E>(
	atom: AtomFamily<V, Key, E> | AtomSymbol<V, E>,
	key?: Key,
) {
	return [
		useAtomValueInternal(atom, key),
		useSetAtomInternal(atom, key),
	] as const
}
