import { derivedAtom, primitiveAtom, type AtomSymbol } from './store'

type Update<T> = T | ((prev: T) => T)

/**
 * Creates an atom synchronized with useLocalStorage and other browser tabs.
 * `parse` and `serialize` must be pure. Storage access runs in the primitive
 * initializer, mount lifecycle, and a private write-only persistence command.
 */
export function localStorageAtom<T extends string = string>(
	key: string,
	parse: (value: string | null) => T,
	serialize?: (value: T) => string,
): AtomSymbol<T, [Update<T>]>
export function localStorageAtom<T>(
	key: string,
	parse: (value: string | null) => T,
	serialize: (value: T) => string,
): AtomSymbol<T, [Update<T>]>
export function localStorageAtom<T>(
	key: string,
	parse: (value: string | null) => T,
	serialize: (value: T) => string = (value: any) => value,
): AtomSymbol<T, [Update<T>]> {
	const getSnapshot = () => {
		if (typeof window === 'undefined') return null
		return localStorage.getItem(key)
	}
	const raw = primitiveAtom<string | null>(getSnapshot, {
		onMount: (_read, write) => {
			if (typeof window === 'undefined') return
			const sync = () => write(raw, getSnapshot())
			window.addEventListener('storage', sync)
			window.addEventListener('local-storage-update', sync)
			sync()
			return () => {
				window.removeEventListener('storage', sync)
				window.removeEventListener('local-storage-update', sync)
			}
		},
	})

	const persist = derivedAtom(null, (_read, write, update: Update<T>) => {
		const next =
			typeof update === 'function'
				? (update as (prev: T) => T)(parse(getSnapshot()))
				: update
		localStorage.setItem(key, serialize(next))
		write(raw, getSnapshot())
		window.dispatchEvent(new Event('local-storage-update'))
	})

	return derivedAtom(
		(read) => parse(read(raw)),
		(_read, write, update: Update<T>) => {
			write(persist, update)
		},
	)
}
