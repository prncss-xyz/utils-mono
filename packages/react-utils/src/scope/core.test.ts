import { describe, expect, it } from 'vitest'

import {
	corePrimaryScope,
	derivedScope,
	ScopeContext,
	ScopeStore,
} from './core'

const flushMicrotask = () => Promise.resolve()

describe('ScopeStore', () => {
	it('mounts dependencies before dependents and unmounts them in reverse order', async () => {
		const lifecycle: string[] = []
		const dependency = corePrimaryScope(() => {
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
})
