import { isoAssert } from '../functions'
import { derivedAtom, primitiveAtom, type PrimitiveSymbol } from './store'

type Commands = Record<string, (arg: any) => void>

type CommandAtoms<T extends Commands> = {
	[K in keyof T]: PrimitiveSymbol<never, Parameters<T[K]>[0]>
}

export function createCommands<T extends Commands>() {
	const dependencyAtom = primitiveAtom<T>(undefined as any)
	const cmd = new Proxy({} as CommandAtoms<T>, {
		get(_target, key: string) {
			return derivedAtom(null, (read, _write, message) => {
				const dependencies = read(dependencyAtom)
				isoAssert(
					dependencies,
					'dependencyAtom must be hydrated with StoreProvider before using commands',
				)
				dependencies[key]!(message)
			})
		},
	})
	return {
		dependencyAtom,
		cmd,
	}
}
