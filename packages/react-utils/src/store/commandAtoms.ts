import { isoAssert } from '../functions'
import { derivedAtom, primitiveAtom, type AtomSymbol } from './store'

type Commands = Record<string, (...args: any[]) => void>

type CommandAtoms<T extends Commands> = {
	[K in keyof T]: AtomSymbol<never, Parameters<T[K]>>
}

export function createCommands<T extends Commands>() {
	const dependencyAtom = primitiveAtom<T>(undefined as any)
	const cmd = new Proxy({} as CommandAtoms<T>, {
		get(_target, key: string) {
			return derivedAtom(null, (read, _write, ...args: any[]) => {
				const dependencies = read(dependencyAtom)
				isoAssert(
					dependencies,
					'dependencyAtom must be hydrated with StoreProvider before using commands',
				)
				dependencies[key]!(...args)
			})
		},
	})
	return {
		dependencyAtom,
		cmd,
	}
}
