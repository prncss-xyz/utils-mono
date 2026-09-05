import { describe, expect, it } from 'vitest'

import { derivedScope, primitiveScope, ScopeContext, ScopeStore } from './core'

const flushMicrotask = () => Promise.resolve()

type StoredScope = StoredScopeStep | StoredScopeInstance

type StoredScopeStep = Readonly<{
	type: 'scopeStep'
	symbol: unknown
	values: Map<unknown, StoredScope>
}>

type StoredScopeInstance = Readonly<{
	type: 'scopeInstance'
	scopes: readonly unknown[]
}>

const getContents = (store: ScopeStore) =>
	(
		store as unknown as {
			contents: Map<unknown, StoredScope>
		}
	).contents

describe('ScopeStore', () => {
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

	it('shares lattice prefixes and caches each value branch', () => {
		const first = primitiveScope<string>()
		const second = primitiveScope<string>()
		const dependent = derivedScope((read) => `${read(first)}:${read(second)}`)
		const leftContext = ScopeContext.init()
			.childScope(first, 'shared')
			.childScope(second, 'left')
		const rightContext = ScopeContext.init()
			.childScope(first, 'shared')
			.childScope(second, 'right')
		const store = new ScopeStore()

		const left = store.resolve(leftContext, dependent)
		const right = store.resolve(rightContext, dependent)

		expect(left).not.toBe(right)
		expect(store.resolve(leftContext, dependent)).toBe(left)
		expect(store.resolve(rightContext, dependent)).toBe(right)

		const root = getContents(store).get(dependent)
		expect(root).toMatchObject({ type: 'scopeStep', symbol: first })
		const sharedPrefix = (root as StoredScopeStep).values.get('shared')
		expect(sharedPrefix).toMatchObject({ type: 'scopeStep', symbol: second })
		expect((sharedPrefix as StoredScopeStep).values.get('left')).toBe(left)
		expect((sharedPrefix as StoredScopeStep).values.get('right')).toBe(right)
		expect(left.type).toBe('scopeInstance')
		expect(right.type).toBe('scopeInstance')
	})

	it('stores and reuses a zero-dependency derived scope directly', () => {
		const unrelated = primitiveScope<string>()
		const constant = derivedScope(() => 'constant')
		const store = new ScopeStore()
		const firstContext = ScopeContext.init().childScope(unrelated, 'first')
		const secondContext = ScopeContext.init().childScope(unrelated, 'second')

		const instance = store.resolve(firstContext, constant)

		expect(store.resolve(secondContext, constant)).toBe(instance)
		expect(getContents(store).get(constant)).toBe(instance)
		expect(instance).toMatchObject({ type: 'scopeInstance', scopes: [] })
	})

	it('prunes an empty suffix while preserving a shared sibling branch', async () => {
		const first = primitiveScope<string>()
		const second = primitiveScope<string>()
		const dependent = derivedScope((read) => `${read(first)}:${read(second)}`)
		const leftContext = ScopeContext.init()
			.childScope(first, 'shared')
			.childScope(second, 'left')
		const rightContext = ScopeContext.init()
			.childScope(first, 'shared')
			.childScope(second, 'right')
		const store = new ScopeStore()
		store.resolve(leftContext, dependent)
		const right = store.resolve(rightContext, dependent)
		const leftDependency = store.resolve(leftContext, second)
		const unmountLeft = store.mount(leftDependency)
		await flushMicrotask()

		unmountLeft()
		await flushMicrotask()

		const root = getContents(store).get(dependent) as StoredScopeStep
		const sharedPrefix = root.values.get('shared') as StoredScopeStep
		expect(sharedPrefix.values.has('left')).toBe(false)
		expect(sharedPrefix.values.get('right')).toBe(right)
		expect(store.resolve(rightContext, dependent)).toBe(right)

		const finalStore = new ScopeStore()
		finalStore.resolve(rightContext, dependent)
		const finalDependency = finalStore.resolve(rightContext, second)
		const unmountFinal = finalStore.mount(finalDependency)
		await flushMicrotask()
		unmountFinal()
		await flushMicrotask()

		expect(getContents(finalStore).has(dependent)).toBe(false)
	})

	it('rejects incompatible dependency paths at the same lattice position', () => {
		const first = primitiveScope<string>()
		const conflicting = primitiveScope<string>()
		const selector = primitiveScope<'first' | 'conflicting'>()
		const dependent = derivedScope((read) =>
			read(selector) === 'first' ? read(first) : read(conflicting),
		)
		const store = new ScopeStore()
		const firstContext = ScopeContext.init()
			.childScope(first, 'first')
			.childScope(conflicting, 'unused')
			.childScope(selector, 'first')
		const conflictingContext = ScopeContext.init()
			.childScope(first, 'unused')
			.childScope(conflicting, 'conflicting')
			.childScope(selector, 'conflicting')
		const firstInstance = store.resolve(firstContext, dependent)

		expect(() => store.resolve(conflictingContext, dependent)).toThrow(
			/scope lattice invariant.*symbol/i,
		)
		expect(store.resolve(firstContext, dependent)).toBe(firstInstance)
	})

	it('uses Map key equality for NaN and signed zero', () => {
		const scope = primitiveScope<number>()
		const dependent = derivedScope((read) => read(scope))
		const store = new ScopeStore()
		const nanContext = ScopeContext.init().childScope(scope, Number.NaN)
		const positiveZeroContext = ScopeContext.init().childScope(scope, 0)
		const negativeZeroContext = ScopeContext.init().childScope(scope, -0)

		const nan = store.resolve(nanContext, dependent)
		const positiveZero = store.resolve(positiveZeroContext, dependent)
		const negativeZero = store.resolve(negativeZeroContext, dependent)

		expect(store.resolve(nanContext, dependent)).toBe(nan)
		expect(negativeZero).toBe(positiveZero)
		expect(store.resolve(positiveZeroContext, dependent)).toBe(positiveZero)
		expect(store.resolve(negativeZeroContext, dependent)).toBe(positiveZero)
	})
})
