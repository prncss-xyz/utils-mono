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
} from './store'

const StoreCtx = createContext<ReturnType<typeof createStore> | null>(null)

function useStore() {
	const store = useContext(StoreCtx)
	if (!store) throw new Error('Atom hooks must be used within a StoreProvider')
	return store
}

/**
 * Creates and hydrates the store on the first render; later hydrate changes are ignored.
 * Remount with a new key to start over. React may retry the initializer before committing
 * (including in StrictMode); hydration runs neither effects nor onMount callbacks.
 */
export function StoreProvider<
	const Entries extends readonly (readonly unknown[])[] = [],
>({
	children,
	hydrate,
}: {
	children: React.ReactNode
	hydrate?: Entries & ValidHydrate<Entries>
}) {
	const [store] = useState(() =>
		hydrate ? createStore(hydrate) : createStore(),
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
