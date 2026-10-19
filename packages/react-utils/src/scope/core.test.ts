import { describe, expect, it, vi } from 'vitest'

import { derivedScope, primitiveScope, ScopeContext, ScopeStore } from './core'

const flushMicrotask = () => Promise.resolve()

describe('ScopeStore', () => {
	it('caches conditional dependencies declared before the branch selector', () => {
		const InputA = primitiveScope<string>()
		const InputB = primitiveScope<string>()
		const Mode = primitiveScope<'a' | 'b'>()
		const Selected = derivedScope((read) => {
			const mode = read(Mode)
			return mode === 'a' ? read(InputA) : read(InputB)
		})
		const store = new ScopeStore()
		const contextA = ScopeContext.init()
			.childScope(InputA, 'apple')
			.childScope(InputB, 'banana')
			.childScope(Mode, 'a')
		const contextB = contextA.childScope(Mode, 'b')

		const instanceA = store.resolve(contextA, Selected)
		expect(instanceA.value).toBe('apple')
		const instanceB = store.resolve(contextB, Selected)
		expect(instanceB.value).toBe('banana')
		expect(store.resolve(contextA, Selected)).toBe(instanceA)
		expect(store.resolve(contextB, Selected)).toBe(instanceB)
	})

	it('preserves Map equality for NaN, signed zero, and object identity', () => {
		const input = primitiveScope<unknown>()
		const derived = derivedScope((read) => ({ input: read(input) }))
		const store = new ScopeStore()
		const context = ScopeContext.init()
		const nan = store.resolve(context.childScope(input, Number.NaN), derived)
		expect(store.resolve(context.childScope(input, Number.NaN), derived)).toBe(
			nan,
		)
		const zero = store.resolve(context.childScope(input, 0), derived)
		expect(store.resolve(context.childScope(input, -0), derived)).toBe(zero)
		expect(zero).not.toBe(nan)
		const value = { name: 'apple' }
		const object = store.resolve(context.childScope(input, value), derived)
		expect(store.resolve(context.childScope(input, value), derived)).toBe(
			object,
		)
		expect(
			store.resolve(context.childScope(input, { name: 'apple' }), derived),
		).not.toBe(object)
	})

	it('distinguishes an undefined binding from a missing required binding', () => {
		const input = primitiveScope<string | undefined>()
		const derived = derivedScope((read) => read(input))
		const store = new ScopeStore()
		const context = ScopeContext.init()
		const provided = context.childScope(input, undefined)
		const instance = store.resolve(provided, derived)
		expect(instance.value).toBeUndefined()
		expect(() => store.resolve(context, derived)).toThrow('not provided')
		expect(store.resolve(provided, derived)).toBe(instance)
	})

	it('cleans up every dependent before a shared dependency', async () => {
		const lifecycle: string[] = []
		const place = primitiveScope<string>((value) => () => {
			lifecycle.push(value)
		})
		const color = primitiveScope<string>(() => () => {
			lifecycle.push('color')
		})
		const description = derivedScope(
			(read) => `${read(color)}:${read(place)}`,
			(value) => () => {
				lifecycle.push(value)
			},
		)
		const store = new ScopeStore()
		const outer = ScopeContext.init()
			.childScope(color, 'blue')
			.childScope(place, 'outer')
		const inner = outer.childScope(place, 'inner')
		const unmountOuter = store.mount(store.resolve(outer, description))
		const unmountInner = store.mount(store.resolve(inner, description))
		await flushMicrotask()
		unmountOuter()
		unmountInner()
		await flushMicrotask()

		expect(lifecycle).toHaveLength(5)
		for (const value of ['outer', 'inner']) {
			expect(lifecycle.indexOf(`blue:${value}`)).toBeLessThan(
				lifecycle.indexOf('color'),
			)
			expect(lifecycle.indexOf(`blue:${value}`)).toBeLessThan(
				lifecycle.indexOf(value),
			)
		}
	})

	it('tracks distinct instances of the same derived scope sharing a dependency', async () => {
		const place = primitiveScope<string>()
		const color = primitiveScope<string>()
		const description = derivedScope(
			(read) => `${read(color)} in ${read(place)}`,
		)
		const store = new ScopeStore()
		const outer = ScopeContext.init()
			.childScope(color, 'blue')
			.childScope(place, 'outer')
		const inner = outer.childScope(place, 'inner')
		const outerInstance = store.resolve(outer, description)
		const innerInstance = store.resolve(inner, description)
		const colorInstance = store.resolve(outer, color)

		expect(colorInstance.subs).toEqual(new Set([outerInstance, innerInstance]))

		const unmountOuter = store.mount(outerInstance)
		const unmountInner = store.mount(innerInstance)
		await flushMicrotask()
		unmountOuter()
		unmountInner()
		await flushMicrotask()

		expect(colorInstance.subs.size).toBe(0)
		expect(store.resolve(outer, description)).not.toBe(outerInstance)
		expect(store.resolve(inner, description)).not.toBe(innerInstance)
	})

	it('mounts dependencies before dependents and unmounts them in reverse order', async () => {
		const lifecycle: string[] = []
		const dependency = primitiveScope(() => {
			lifecycle.push('mount dependency')
			return () => lifecycle.push('unmount dependency')
		})
		const dependent = derivedScope(
			(read) => read(dependency),
			() => {
				lifecycle.push('mount dependent')
				return () => lifecycle.push('unmount dependent')
			},
		)
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(dependency, 'value')
		const instance = store.resolve(context, dependent)

		const unmount = store.mount(instance)
		await flushMicrotask()
		unmount()
		await flushMicrotask()

		expect(lifecycle).toEqual([
			'mount dependency',
			'mount dependent',
			'unmount dependent',
			'unmount dependency',
		])
	})

	it('removes an unmounted primitive instance from the cache', async () => {
		const scope = primitiveScope<string>()
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(scope, 'value')
		const instance = store.resolve(context, scope)

		const unmount = store.mount(instance)
		await flushMicrotask()
		unmount()
		await flushMicrotask()

		expect(store.resolve(context, scope)).not.toBe(instance)
	})

	it('removes every transitive dependent of an unmounted primitive instance', async () => {
		const scope = primitiveScope<string>()
		const dependent = derivedScope((read) => read(scope).toUpperCase())
		const transitive = derivedScope((read) => `${read(dependent)}!`)
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(scope, 'value')
		const scopeInstance = store.resolve(context, scope)
		const dependentInstance = store.resolve(context, dependent)
		const transitiveInstance = store.resolve(context, transitive)

		const unmount = store.mount(transitiveInstance)
		await flushMicrotask()
		unmount()
		await flushMicrotask()

		expect(store.resolve(context, scope)).not.toBe(scopeInstance)
		expect(store.resolve(context, dependent)).not.toBe(dependentInstance)
		expect(store.resolve(context, transitive)).not.toBe(transitiveInstance)
	})

	it('preserves entries belonging to another primitive scope instance', async () => {
		const scope = primitiveScope<string>()
		const dependent = derivedScope((read) => read(scope).toUpperCase())
		const store = new ScopeStore()
		const firstContext = ScopeContext.init().childScope(scope, 'first')
		const secondContext = ScopeContext.init().childScope(scope, 'second')
		const firstInstance = store.resolve(firstContext, dependent)
		const secondInstance = store.resolve(secondContext, dependent)

		const unmountFirst = store.mount(firstInstance)
		const unmountSecond = store.mount(secondInstance)
		await flushMicrotask()
		unmountFirst()
		await flushMicrotask()

		expect(store.resolve(firstContext, dependent)).not.toBe(firstInstance)
		expect(store.resolve(secondContext, dependent)).toBe(secondInstance)

		unmountSecond()
		await flushMicrotask()

		expect(store.resolve(secondContext, dependent)).not.toBe(secondInstance)
	})

	it('removes shared dependents only once', async () => {
		const scope = primitiveScope<string>()
		const left = derivedScope((read) => read(scope).toUpperCase())
		const right = derivedScope((read) => read(scope).toLowerCase())
		const shared = derivedScope((read) => `${read(left)}:${read(right)}`)
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(scope, 'Value')
		const instance = store.resolve(context, shared)

		const unmount = store.mount(instance)
		await flushMicrotask()
		unmount()
		await flushMicrotask()

		expect(store.resolve(context, shared)).not.toBe(instance)
	})
})

describe('conditional scope dependencies', () => {
	it.each([
		{ warm: false, firstMode: 'a' as const },
		{ warm: false, firstMode: 'b' as const },
		{ warm: true, firstMode: 'a' as const },
		{ warm: true, firstMode: 'b' as const },
	])(
		'resolves nested branches with warm=$warm, firstMode=$firstMode',
		({ warm, firstMode }) => {
			const inputA = primitiveScope<string>()
			const inputB = primitiveScope<string>()
			const mode = primitiveScope<'a' | 'b'>()
			const getA = vi.fn((value: string) => value.toUpperCase())
			const getB = vi.fn((value: string) => value.toUpperCase())
			const serviceA = derivedScope((read) => getA(read(inputA)))
			const serviceB = derivedScope((read) => getB(read(inputB)))
			const selector = derivedScope((read) => read(mode))
			const selected = derivedScope((read) =>
				read(selector) === 'a' ? read(serviceA) : read(serviceB),
			)
			const wrapped = derivedScope((read) => `selected: ${read(selected)}`)
			const store = new ScopeStore()
			const contextA = ScopeContext.init()
				.childScope(inputA, 'apple')
				.childScope(inputB, 'banana')
				.childScope(mode, 'a')
			const contextB = contextA.childScope(mode, 'b')
			if (warm) {
				store.resolve(contextA, serviceA)
				store.resolve(contextB, serviceB)
				store.resolve(contextA, selector)
				store.resolve(contextB, selector)
			}
			const firstContext = firstMode === 'a' ? contextA : contextB
			const secondContext = firstMode === 'a' ? contextB : contextA
			const first = store.resolve(firstContext, wrapped)
			expect(first.value).toBe(
				firstMode === 'a' ? 'selected: APPLE' : 'selected: BANANA',
			)
			const second = store.resolve(secondContext, wrapped)
			expect(second.value).toBe(
				firstMode === 'a' ? 'selected: BANANA' : 'selected: APPLE',
			)
			expect(second).not.toBe(first)
			expect(store.resolve(firstContext, wrapped)).toBe(first)
			expect(store.resolve(secondContext, wrapped)).toBe(second)
			expect(getA).toHaveBeenCalledTimes(1)
			expect(getB).toHaveBeenCalledTimes(1)
		},
	)

	it('deduplicates repeated direct and transitive reads while retaining branch identity', async () => {
		const mode = primitiveScope<'a' | 'b'>()
		const input = primitiveScope<string>()
		const cleanup = vi.fn()
		const mount = vi.fn(() => cleanup)
		const shared = derivedScope((read) => read(input), mount)
		const selected = derivedScope((read) => {
			const branch = read(mode)
			const first = read(shared)
			const direct = read(input)
			const second = read(shared)
			return `${branch}:${first}:${direct}:${second}:${read(mode)}`
		})
		const store = new ScopeStore()
		const contextA = ScopeContext.init()
			.childScope(input, 'apple')
			.childScope(mode, 'a')
		const contextB = contextA.childScope(mode, 'b')
		const instanceA = store.resolve(contextA, selected)
		const instanceB = store.resolve(contextB, selected)
		expect(instanceA.value).toBe('a:apple:apple:apple:a')
		expect(instanceB.value).toBe('b:apple:apple:apple:b')
		expect(store.resolve(contextA, selected)).toBe(instanceA)
		expect(store.resolve(contextB, selected)).toBe(instanceB)
		const sharedInstance = store.resolve(contextA, shared)
		const releaseA = store.mount(instanceA)
		const releaseB = store.mount(instanceB)
		await flushMicrotask()
		expect(sharedInstance.mountCount).toBe(2)
		expect(mount).toHaveBeenCalledTimes(1)
		releaseA()
		await flushMicrotask()
		expect(sharedInstance.mountCount).toBe(1)
		expect(cleanup).not.toHaveBeenCalled()
		releaseB()
		await flushMicrotask()
		expect(sharedInstance.mountCount).toBe(0)
		expect(cleanup).toHaveBeenCalledTimes(1)
	})

	it.each(['short', 'long'] as const)(
		'caches different dependency path lengths starting with %s',
		(firstMode) => {
			const input = primitiveScope<string>()
			const mode = primitiveScope<'short' | 'long'>()
			const selected = derivedScope((read) =>
				read(mode) === 'short' ? 'constant' : read(input),
			)
			const store = new ScopeStore()
			const shortContext = ScopeContext.init()
				.childScope(input, 'apple')
				.childScope(mode, 'short')
			const longContext = shortContext.childScope(mode, 'long')
			const firstContext = firstMode === 'short' ? shortContext : longContext
			const secondContext = firstMode === 'short' ? longContext : shortContext
			const first = store.resolve(firstContext, selected)
			expect(first.value).toBe(firstMode === 'short' ? 'constant' : 'apple')
			const second = store.resolve(secondContext, selected)
			expect(second.value).toBe(firstMode === 'short' ? 'apple' : 'constant')
			expect(store.resolve(firstContext, selected)).toBe(first)
			expect(store.resolve(secondContext, selected)).toBe(second)
			const shortInstance = firstMode === 'short' ? first : second
			expect(
				store.resolve(shortContext.childScope(input, 'pear'), selected),
			).toBe(shortInstance)
		},
	)

	it('evicts an inactive branch while preserving the mounted alternative', async () => {
		const inputA = primitiveScope<string>()
		const inputB = primitiveScope<string>()
		const mode = primitiveScope<'a' | 'b'>()
		const cleanupA = vi.fn()
		const cleanupB = vi.fn()
		const mountA = vi.fn(() => cleanupA)
		const mountB = vi.fn(() => cleanupB)
		const serviceA = derivedScope((read) => read(inputA), mountA)
		const serviceB = derivedScope((read) => read(inputB), mountB)
		const selected = derivedScope((read) =>
			read(mode) === 'a' ? read(serviceA) : read(serviceB),
		)
		const store = new ScopeStore()
		const contextA = ScopeContext.init()
			.childScope(inputA, 'apple')
			.childScope(mode, 'a')
		const contextB = ScopeContext.init()
			.childScope(inputB, 'banana')
			.childScope(mode, 'b')
		const instanceA = store.resolve(contextA, selected)
		const releaseA = store.mount(instanceA)
		await flushMicrotask()
		expect(mountA).toHaveBeenCalledTimes(1)
		expect(mountB).not.toHaveBeenCalled()
		const instanceB = store.resolve(contextB, selected)
		const releaseB = store.mount(instanceB)
		await flushMicrotask()
		expect(mountB).toHaveBeenCalledTimes(1)
		releaseA()
		await flushMicrotask()
		expect(cleanupA).toHaveBeenCalledTimes(1)
		expect(cleanupB).not.toHaveBeenCalled()
		expect(store.resolve(contextB, selected)).toBe(instanceB)
		const recreatedA = store.resolve(contextA, selected)
		expect(recreatedA).not.toBe(instanceA)
		expect(recreatedA.value).toBe('apple')
		releaseB()
		await flushMicrotask()
		expect(cleanupB).toHaveBeenCalledTimes(1)
		expect(store.resolve(contextA, selected)).toBe(recreatedA)
	})

	it.each(['a', 'b'] as const)(
		'does not require inactive branch inputs starting with %s',
		(firstMode) => {
			const inputA = primitiveScope<string>()
			const inputB = primitiveScope<string>()
			const mode = primitiveScope<'a' | 'b'>()
			const selected = derivedScope((read) =>
				read(mode) === 'a' ? read(inputA) : read(inputB),
			)
			const store = new ScopeStore()
			const contextA = ScopeContext.init()
				.childScope(inputA, 'apple')
				.childScope(mode, 'a')
			const contextB = ScopeContext.init()
				.childScope(inputB, 'banana')
				.childScope(mode, 'b')
			const firstContext = firstMode === 'a' ? contextA : contextB
			const secondContext = firstMode === 'a' ? contextB : contextA
			const first = store.resolve(firstContext, selected)
			expect(first.value).toBe(firstMode === 'a' ? 'apple' : 'banana')
			const second = store.resolve(secondContext, selected)
			expect(second.value).toBe(firstMode === 'a' ? 'banana' : 'apple')
			expect(store.resolve(firstContext, selected)).toBe(first)
			expect(store.resolve(secondContext, selected)).toBe(second)
		},
	)
})

describe('batched scope lifecycle', () => {
	it('skips effects when released before the first flush', async () => {
		const start = vi.fn()
		const scope = primitiveScope(start)
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(scope, 'value')
		const instance = store.resolve(context, scope)
		store.mount(instance)()
		await flushMicrotask()
		expect(start).not.toHaveBeenCalled()
		expect(store.resolve(context, scope)).not.toBe(instance)
	})

	it.each([false, true])(
		'coalesces remounts with existing activity: %s',
		async (alreadyActive) => {
			const cleanup = vi.fn()
			const start = vi.fn(() => cleanup)
			const scope = primitiveScope(start)
			const store = new ScopeStore()
			const context = ScopeContext.init().childScope(scope, 'value')
			const instance = store.resolve(context, scope)
			const release = store.mount(instance)
			if (alreadyActive) await flushMicrotask()
			release()
			const releaseAgain = store.mount(instance)
			await flushMicrotask()
			expect(start).toHaveBeenCalledTimes(1)
			expect(cleanup).not.toHaveBeenCalled()
			expect(store.resolve(context, scope)).toBe(instance)
			releaseAgain()
			await flushMicrotask()
			expect(cleanup).toHaveBeenCalledTimes(1)
		},
	)

	it('cleans and evicts a shared graph once after repeated releases in one batch', async () => {
		const cleanup = vi.fn()
		const start = vi.fn(() => cleanup)
		const dependency = primitiveScope(start)
		const left = derivedScope((read) => read(dependency))
		const right = derivedScope((read) => read(dependency))
		const root = derivedScope((read) => [read(left), read(right)])
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(dependency, 'value')
		const instance = store.resolve(context, root)
		const release = store.mount(instance)
		await flushMicrotask()
		release()
		store.mount(instance)()
		store.mount(instance)()
		await flushMicrotask()
		expect(start).toHaveBeenCalledTimes(1)
		expect(cleanup).toHaveBeenCalledTimes(1)
		expect(store.resolve(context, root)).not.toBe(instance)
	})

	it('preserves active effects that return no cleanup', async () => {
		const start = vi.fn()
		const scope = derivedScope(() => 'value', start)
		const store = new ScopeStore()
		const instance = store.resolve(ScopeContext.init(), scope)
		const release = store.mount(instance)
		await flushMicrotask()
		release()
		const releaseAgain = store.mount(instance)
		await flushMicrotask()
		expect(start).toHaveBeenCalledTimes(1)
		releaseAgain()
		await flushMicrotask()
		const releaseLater = store.mount(instance)
		await flushMicrotask()
		expect(start).toHaveBeenCalledTimes(1)
		releaseLater()
		await flushMicrotask()
	})

	it('releases each consumer only once, including shared dependencies', async () => {
		const cleanup = vi.fn()
		const dependency = primitiveScope(() => cleanup)
		const left = derivedScope((read) => read(dependency))
		const right = derivedScope((read) => read(dependency))
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(dependency, 'value')
		const dependencyInstance = store.resolve(context, dependency)
		const releaseLeft = store.mount(store.resolve(context, left))
		const releaseRight = store.mount(store.resolve(context, right))
		await flushMicrotask()
		releaseLeft()
		releaseLeft()
		await flushMicrotask()
		expect(dependencyInstance.mountCount).toBe(1)
		expect(cleanup).not.toHaveBeenCalled()
		releaseRight()
		releaseRight()
		await flushMicrotask()
		expect(dependencyInstance.mountCount).toBe(0)
		expect(cleanup).toHaveBeenCalledTimes(1)
	})
})

describe('store disposal', () => {
	it('retains dependency-free derived effects until store disposal', async () => {
		const lifecycle: string[] = []
		const dependency = derivedScope(
			() => 'value',
			() => () => {
				lifecycle.push('dependency')
			},
		)
		const dependent = derivedScope(
			(read) => read(dependency),
			() => () => {
				lifecycle.push('dependent')
			},
		)
		const store = new ScopeStore()
		const unmountStore = store.mountStore()
		const context = ScopeContext.init()
		const instance = store.resolve(context, dependent)
		const release = store.mount(instance)
		await flushMicrotask()
		release()
		await flushMicrotask()
		expect(lifecycle).toEqual([])
		expect(store.resolve(context, dependent)).toBe(instance)
		unmountStore()
		unmountStore()
		await flushMicrotask()
		expect(lifecycle).toEqual(['dependent', 'dependency'])
		expect(() => store.resolve(context, dependent)).toThrow('unmounted store')
	})

	it('disposes active graphs before late consumer releases', async () => {
		const cleanup = vi.fn()
		const scope = primitiveScope(() => cleanup)
		const store = new ScopeStore()
		const unmountStore = store.mountStore()
		const context = ScopeContext.init().childScope(scope, 'value')
		const release = store.mount(store.resolve(context, scope))
		await flushMicrotask()
		unmountStore()
		await flushMicrotask()
		release()
		await flushMicrotask()
		expect(cleanup).toHaveBeenCalledTimes(1)
	})

	it('cancels pending mounts on disposal', async () => {
		const start = vi.fn()
		const store = new ScopeStore()
		const unmountStore = store.mountStore()
		store.mount(
			store.resolve(
				ScopeContext.init(),
				derivedScope(() => 'value', start),
			),
		)
		unmountStore()
		await flushMicrotask()
		expect(start).not.toHaveBeenCalled()
	})
})

describe('store ownership', () => {
	it('coalesces effect replay without cleaning retained scopes', async () => {
		const cleanup = vi.fn()
		const start = vi.fn(() => cleanup)
		const store = new ScopeStore()
		const context = ScopeContext.init()
		const scope = derivedScope(() => 'value', start)
		const instance = store.resolve(context, scope)
		const unmountStore = store.mountStore()
		const release = store.mount(instance)
		await flushMicrotask()
		release()
		unmountStore()
		const unmountAgain = store.mountStore()
		const releaseAgain = store.mount(instance)
		await flushMicrotask()
		expect(start).toHaveBeenCalledTimes(1)
		expect(cleanup).not.toHaveBeenCalled()
		expect(store.resolve(context, scope)).toBe(instance)
		releaseAgain()
		unmountAgain()
		await flushMicrotask()
		expect(cleanup).toHaveBeenCalledTimes(1)
		expect(() => store.mountStore()).toThrow('unmounted store')
	})

	it('waits for every owner and releases each owner once', async () => {
		const store = new ScopeStore()
		const first = store.mountStore()
		const second = store.mountStore()
		first()
		first()
		await flushMicrotask()
		expect(() =>
			store.resolve(
				ScopeContext.init(),
				derivedScope(() => 'value'),
			),
		).not.toThrow()
		second()
		await flushMicrotask()
		expect(() => store.mountStore()).toThrow('unmounted store')
	})
})
