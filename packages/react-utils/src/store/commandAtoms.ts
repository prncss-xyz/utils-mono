import { isoAssert } from '../functions'
import { commandAtom, primitiveAtom, type AtomSymbol } from './store'

type Commands = Record<string, (...args: any[]) => void>

type CommandAtoms<T extends Commands> = {
	[K in keyof T]: AtomSymbol<never, Parameters<T[K]>>
}

/** Async handlers are not awaited; handle promise errors yourself. */
export function createCommands<T extends Commands>() {
	const dependencyAtom = primitiveAtom<T>(undefined as any)
	const cache = new Map<PropertyKey, AtomSymbol<never, any>>()
	const cmd = new Proxy({} as CommandAtoms<T>, {
		get(_target, key: string) {
			let atom = cache.get(key)
			if (!atom) {
				atom = commandAtom((read, _write, ...args: any[]) => {
					const dependencies = read(dependencyAtom)
					isoAssert(
						dependencies,
						'dependencyAtom must be hydrated with StoreProvider before using commands',
					)
					dependencies[key]!(...args)
				})
				cache.set(key, atom)
			}
			return atom
		},
	})
	return {
		dependencyAtom,
		cmd,
	}
}
