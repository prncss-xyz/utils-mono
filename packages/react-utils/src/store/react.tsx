'use client'
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'

import { isoAssert } from '../functions'
import {
	createStore,
	type AtomFamily,
	type AtomSymbol,
	type EffectAtom,
	type ValidHydrate,
	type ResolvedAtom,
	type Store,
} from './store'

const StoreCtx = createContext<Store | null>(null)

/** Returns the store of the nearest `StoreProvider`. */
export function useStore(): Store {
	const store = useContext(StoreCtx)
	if (!store) throw new Error('useStore must be used within a StoreProvider')
	return store
}

type StoreProviderProps<Entries extends readonly (readonly unknown[])[]> = {
	children: React.ReactNode
} & (
	| { store: Store; hydrate?: never }
	| { store?: never; hydrate?: Entries & ValidHydrate<Entries> }
)

/**
 * Provides `store`, which lets code outside React share state with the tree,
 * or else creates and hydrates a store. Either is bound on the first render;
 * later `store` and `hydrate` changes are ignored. Remount with a new key to
 * start over. React may retry the initializer before committing (including in
 * StrictMode); hydration runs neither effects nor onMount callbacks.
 */
export function StoreProvider<
	const Entries extends readonly (readonly unknown[])[] = [],
>({ children, store: provided, hydrate }: StoreProviderProps<Entries>) {
	const [store] = useState(
		() => provided ?? (hydrate ? createStore(hydrate) : createStore()),
	)
	return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>
}

export function useMountEffect(effect: EffectAtom): void {
	const store = useStore()
	useEffect(() => store.mountEffect(effect), [store, effect])
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
	isoAssert(
		atom.type === 'primitive' ||
			atom.type === 'derived' ||
			atom.type === 'family',
		'effect atoms have no value',
	)
	const resolvedAtomRef = useRef<
		| {
				store: Store
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
