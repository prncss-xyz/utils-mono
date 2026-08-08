import { useSyncExternalStore } from 'react'

export function useLocalStorage<T extends string = string>(
	key: string,
	parse: (value: string | null) => T,
	serialize?: (value: T) => string,
): readonly [T, (newValue: T | ((prev: T) => T)) => void]
export function useLocalStorage<T>(
	key: string,
	parse: (value: string | null) => T,
	serialize: (value: T) => string,
): readonly [T, (newValue: T | ((prev: T) => T)) => void]
export function useLocalStorage<T>(
	key: string,
	parse: (value: string | null) => T,
	serialize: (value: T) => string = (t: any) => t,
) {
	// Subscribe to changes: storage event handles other tabs/windows,
	// while custom local-storage-update handles the same window.
	const subscribe = (callback: () => void) => {
		window.addEventListener('storage', callback)
		window.addEventListener('local-storage-update', callback)
		return () => {
			window.removeEventListener('storage', callback)
			window.removeEventListener('local-storage-update', callback)
		}
	}

	const getSnapshot = () => {
		try {
			return localStorage.getItem(key)
		} catch (_) {
			return null
		}
	}

	const getServerSnapshot = () => null

	const rawValue = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	)

	const value = parse(rawValue)

	const setValue = (newValue: any) => {
		const nextValue =
			typeof newValue === 'function' ? newValue(value) : newValue
		localStorage.setItem(key, serialize(nextValue))
		window.dispatchEvent(new Event('local-storage-update'))
	}

	return [value, setValue] as const
}
