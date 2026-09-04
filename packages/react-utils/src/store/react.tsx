'use client'
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useSyncExternalStore,
} from 'react'

import {
	createStore,
	type AtomFamily,
	type AtomSymbol,
	type Hydrate,
	type ResolvedAtom,
} from './store'

const StoreCtx = createContext(createStore())

export function StoreProvider({
	children,
	hydrate,
}: {
	children: React.ReactNode
	hydrate?: Hydrate
}) {
	return (
		<StoreCtx.Provider value={hydrate ? createStore(hydrate) : createStore()}>
			{children}
		</StoreCtx.Provider>
	)
}

function useResolvedAtom<V, Key, E>(
	atom: AtomFamily<V, Key, E> | AtomSymbol<V, E>,
	key?: Key,
) {
	const store = useContext(StoreCtx)
	return useMemo(
		() =>
			atom.type === 'family' ? store.resolve(atom, key!) : store.resolve(atom),
		[atom, key, store],
	)
}

function useResolvedAtomValue<V, E>(atom: ResolvedAtom<V, E>) {
	return useSyncExternalStore(atom.subscribe, atom.peek, atom.peek)
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
	return useResolvedAtomValue(useResolvedAtom(atom, key))
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
	const store = useContext(StoreCtx)
	const resolvedAtomRef = useRef<ResolvedAtom<V, E> | undefined>(undefined)
	return useCallback(
		(event: E) => {
			resolvedAtomRef.current ??=
				atom.type === 'family' ? store.resolve(atom, key!) : store.resolve(atom)
			resolvedAtomRef.current.send(event)
		},
		[atom, key, store],
	)
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
	const resolvedAtom = useResolvedAtom(atom, key)
	return [useResolvedAtomValue(resolvedAtom), resolvedAtom.send] as const
}
