import { createContext, use, useEffect, type FC, type ReactNode } from 'react'

import {
	corePrimaryScope,
	ScopeContext,
	ScopeStore,
	type OnMount,
	type PrimaryScopeSymbol,
	type ScopeLike,
} from './core'

export const ScopingProvider = createContext({
	store: new ScopeStore(),
	context: ScopeContext.init(),
})

type Props<Value> = Readonly<{
	value: Value
	children: ReactNode
}>

export function primaryScope<Value>(
	onMount?: OnMount<Value>,
): FC<Props<Value>> & PrimaryScopeSymbol<Value> {
	const s = corePrimaryScope(onMount)
	function Component({ value, children }: Props<Value>) {
		const { store, context } = use(ScopingProvider)
		return (
			<ScopingProvider
				value={{
					store,
					context: context.childScope(Component as unknown as typeof s, value),
				}}
			>
				{children}
			</ScopingProvider>
		)
	}
	for (const [k, v] of Object.entries(s)) {
		;(Component as any)[k] = v
	}
	return Component as any
}

export function useScope<Value>(scope: ScopeLike<Value>) {
	const { store, context } = use(ScopingProvider)
	const instance = store.resolve(context, scope)
	useEffect(() => store.mount(instance), [store, instance])
	return instance.value
}
