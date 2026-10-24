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

function useResolvedAtom<V, Key, Args extends unknown[]>(
	atom: AtomFamily<V, Key, Args> | AtomSymbol<V, Args>,
	key?: Key,
) {
	const store = useStore()
	return atom.type === 'family'
		? store.resolve(atom, key!)
		: store.resolve(atom)
}

function useResolvedAtomValue<V, Args extends unknown[]>(
	atom: ResolvedAtom<V, Args>,
) {
	return useSyncExternalStore(atom.subscribe, atom.peek, atom.peek)
}

export function useAtomValue<V, Key, Args extends unknown[]>(
	atom: AtomFamily<V, Key, Args>,
	key: Key,
): V
export function useAtomValue<V, Args extends unknown[]>(
	atom: AtomSymbol<V, Args>,
): V
export function useAtomValue<V, Key, Args extends unknown[]>(
	atom: AtomFamily<V, Key, Args> | AtomSymbol<V, Args>,
	key?: Key,
) {
	return useResolvedAtomValue(useResolvedAtom(atom, key))
}

export function useSetAtom<V, Key, Args extends unknown[]>(
	atom: AtomFamily<V, Key, Args>,
	key: Key,
): (...args: Args) => void
export function useSetAtom<V, Args extends unknown[]>(
	atom: AtomSymbol<V, Args>,
): (...args: Args) => void
export function useSetAtom<V, Key, Args extends unknown[]>(
	atom: AtomFamily<V, Key, Args> | AtomSymbol<V, Args>,
	key?: Key,
) {
	const store = useStore()
	const resolvedAtomRef = useRef<
		| {
				store: ReturnType<typeof createStore>
				atom: AtomFamily<V, Key, Args> | AtomSymbol<V, Args>
				key: Key | undefined
				resolved: ResolvedAtom<V, Args>
		  }
		| undefined
	>(undefined)
	return (...args: Args) => {
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
		cached.resolved.send(...args)
	}
}

export function useAtom<V, Key, Args extends unknown[]>(
	atom: AtomFamily<V, Key, Args>,
	key: Key,
): readonly [V, (...args: Args) => void]
export function useAtom<V, Args extends unknown[]>(
	atom: AtomSymbol<V, Args>,
): readonly [V, (...args: Args) => void]
export function useAtom<V, Key, Args extends unknown[]>(
	atom: AtomFamily<V, Key, Args> | AtomSymbol<V, Args>,
	key?: Key,
) {
	const resolvedAtom = useResolvedAtom(atom, key)
	return [useResolvedAtomValue(resolvedAtom), resolvedAtom.send] as const
}
