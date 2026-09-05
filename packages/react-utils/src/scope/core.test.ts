import { describe, expect, it } from 'vitest'

import { derivedScope, primaryScope, ScopeContext, ScopeStore } from './core'

const flushMicrotask = () => Promise.resolve()

describe('ScopeStore', () => {
	it('mounts dependencies before dependents and unmounts them in reverse order', async () => {
		const lifecycle: string[] = []
		const dependency = primaryScope(() => {
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

	it('removes an unmounted primary instance from the cache', async () => {
		const scope = primaryScope<string>()
		const store = new ScopeStore()
		const context = ScopeContext.init().childScope(scope, 'value')
		const instance = store.resolve(context, scope)

		const unmount = store.mount(instance)
		await flushMicrotask()
		unmount()
		await flushMicrotask()

		expect(store.resolve(context, scope)).not.toBe(instance)
	})

	it('removes every transitive dependent of an unmounted primary instance', async () => {
		const scope = primaryScope<string>()
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

	it('preserves entries belonging to another primary scope instance', async () => {
		const scope = primaryScope<string>()
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
		const scope = primaryScope<string>()
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
