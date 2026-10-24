'use client'
import { createContext, useContext, useRef, useSyncExternalStore } from 'react'

import {
	createStore,
	type AtomFamily,
	type AtomSymbol,
	type Hydrate,
	type ResolvedAtom,
} from './store'

const StoreCtx = createContext<ReturnType<typeof createStore> | null>(null)

function useStore() {
	const store = useContext(StoreCtx)
	if (!store) throw new Error('Atom hooks must be used within a StoreProvider')
	return store
}

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
	const store = useStore()
	return atom.type === 'family'
		? store.resolve(atom, key!)
		: store.resolve(atom)
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
	const store = useStore()
	const resolvedAtomRef = useRef<
		| {
				store: ReturnType<typeof createStore>
				atom: AtomFamily<V, Key, E> | AtomSymbol<V, E>
				key: Key | undefined
				resolved: ResolvedAtom<V, E>
		  }
		| undefined
	>(undefined)
	return (event: E) => {
		let cached = resolvedAtomRef.current
		if (
			!cached ||
			cached.store !== store ||
			cached.atom !== atom ||
			!Object.is(cached.key, key)
		) {
			const resolved =
				atom.type === 'family' ? store.resolve(atom, key!) : store.resolve(atom)
			cached = { store, atom, key, resolved }
			resolvedAtomRef.current = cached
		}
		cached.resolved.send(event)
	}
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
