import { describe, expect, it, vi } from 'vitest'

import { createCommands } from './commandAtoms'
import { createStore, hydrate } from './store'

describe('createCommands', () => {
	it('reserves then and resolves as a non-thenable', async () => {
		const { cmd } = createCommands<{ save: (n: number) => void }>()
		expect((cmd as any).then).toBeUndefined()
		expect(await Promise.resolve(cmd)).toBe(cmd)
	})

	it('rejects a then command at the type level', () => {
		const checkTypes = () => {
			// @ts-expect-error then is reserved and cannot be a command
			createCommands<{ then: () => void }>()
		}
		expect(checkTypes).toBeTypeOf('function')
	})

	it('returns undefined for symbol keys', () => {
		const { cmd } = createCommands<{ save: (n: number) => void }>()
		expect((cmd as any)[Symbol.iterator]).toBeUndefined()
		expect((cmd as any)[Symbol.toPrimitive]).toBeUndefined()
	})

	it('throws synchronously naming an unknown command', () => {
		const { cmd, dependencyAtom } = createCommands<{ save: () => void }>()
		const store = createStore([hydrate(dependencyAtom, { save: vi.fn() })])
		expect(() => store.send((cmd as any).unknown)).toThrow(/command "unknown"/)
	})

	it('keeps the hydration assertion when unhydrated', () => {
		const { cmd } = createCommands<{ save: () => void }>()
		const store = createStore()
		expect(() => store.send(cmd.save)).toThrow(/must be hydrated/)
	})

	it('caches atoms by key', () => {
		const { cmd } = createCommands<{ a: () => void; b: () => void }>()
		expect(cmd.a).toBe(cmd.a)
		expect(cmd.a).not.toBe(cmd.b)
	})

	it('invokes hydrated handlers with arguments as methods of the hydrated object', () => {
		const { cmd, dependencyAtom } = createCommands<{
			save: (n: number, s: string) => void
		}>()
		const deps = { save: vi.fn() }
		const store = createStore([hydrate(dependencyAtom, deps)])
		store.send(cmd.save, 1, 'x')
		expect(deps.save).toHaveBeenCalledWith(1, 'x')
		expect(deps.save.mock.contexts[0]).toBe(deps)
	})
})
