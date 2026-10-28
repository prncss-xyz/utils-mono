import { cached, isFunction, isoAssert } from '../functions'
import { derivedAtom, primitiveAtom, type AtomSymbol } from './store'

type Commands = Record<string, (...args: any[]) => void> & { then?: never }

type CommandAtoms<T extends Commands> = {
	[K in keyof T]: AtomSymbol<never, Parameters<T[K]>>
}

export function createCommands<T extends Commands>() {
	const dependencyAtom = primitiveAtom<T>(undefined as any)
	const getCommandAtom = cached((key: string) =>
		derivedAtom(null, (read, _write, ...args: any[]) => {
			const dependencies = read(dependencyAtom)
			isoAssert(
				dependencies,
				'dependencyAtom must be hydrated with StoreProvider before using commands',
			)
			isoAssert(
				isFunction(dependencies[key]),
				`command "${key}" has no function handler in the hydrated dependencies`,
			)
			dependencies[key](...args)
		}),
	)
	const cmd = new Proxy({} as CommandAtoms<T>, {
		get(_target, key) {
			if (typeof key === 'symbol' || key === 'then') return undefined
			return getCommandAtom(key)
		},
	})
	return {
		dependencyAtom,
		cmd,
	}
}
