import { describe, expect, it, vi } from 'vitest'

import { derivedScope, primitiveScope, ScopeContext, ScopeStore } from './core'

const flushMicrotask = () => Promise.resolve()

describe('ScopeStore', () => {
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

		expect(colorInstance.dependents).toEqual([outerInstance, innerInstance])

		const unmountOuter = store.mount(outerInstance)
		const unmountInner = store.mount(innerInstance)
		await flushMicrotask()
		unmountOuter()
		unmountInner()
		await flushMicrotask()

		expect(colorInstance.dependents).toEqual([])
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
		expect(start).toHaveBeenCalledTimes(2)
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
		expect(dependencyInstance.count).toBe(1)
		expect(cleanup).not.toHaveBeenCalled()
		releaseRight()
		releaseRight()
		await flushMicrotask()
		expect(dependencyInstance.count).toBe(0)
		expect(cleanup).toHaveBeenCalledTimes(1)
	})
})
