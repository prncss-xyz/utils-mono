import { derivedAtom, primitiveAtom, type AtomSymbol } from './store'

type Update<T> = T | ((prev: T) => T)

/** Creates an atom synchronized with useLocalStorage and other browser tabs. */
export function localStorageAtom<T extends string = string>(
	key: string,
	parse: (value: string | null) => T,
	serialize?: (value: T) => string,
): AtomSymbol<T, Update<T>>
export function localStorageAtom<T>(
	key: string,
	parse: (value: string | null) => T,
	serialize: (value: T) => string,
): AtomSymbol<T, Update<T>>
export function localStorageAtom<T>(
	key: string,
	parse: (value: string | null) => T,
	serialize: (value: T) => string = (value: any) => value,
): AtomSymbol<T, Update<T>> {
	const getSnapshot = () => {
		try {
			return localStorage.getItem(key)
		} catch (_) {
			return null
		}
	}
	const raw = primitiveAtom<string | null>(getSnapshot, {
		onMount: (_get, set) => {
			if (typeof window === 'undefined') return
			const sync = () => set(raw, getSnapshot())
			window.addEventListener('storage', sync)
			window.addEventListener('local-storage-update', sync)
			sync()
			return () => {
				window.removeEventListener('storage', sync)
				window.removeEventListener('local-storage-update', sync)
			}
		},
	})

	return derivedAtom(
		(read) => parse(read(raw)),
		(_read, write, update: Update<T>) => {
			const next =
				typeof update === 'function'
					? (update as (prev: T) => T)(parse(getSnapshot()))
					: update
			localStorage.setItem(key, serialize(next))
			write(raw, getSnapshot())
			window.dispatchEvent(new Event('local-storage-update'))
		},
	)
}
