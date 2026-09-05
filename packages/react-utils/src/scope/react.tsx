import { createContext, use, useEffect, type FC, type ReactNode } from 'react'

import {
	primitiveScope as corePrimitiveScope,
	ScopeContext,
	ScopeStore,
	type OnMount,
	type PrimitiveScopeSymbol,
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

export function primitiveScope<Value>(
	onMount?: OnMount<Value>,
): FC<Props<Value>> & PrimitiveScopeSymbol<Value> {
	const symbol = corePrimitiveScope(onMount)
	function ScopeProvider({ value, children }: Props<Value>) {
		const { store, context } = use(ScopingProvider)
		const scope = ScopeProvider as unknown as PrimitiveScopeSymbol<Value>
		return (
			<ScopingProvider
				value={{
					store,
					context: context.childScope(scope, value),
				}}
			>
				{children}
			</ScopingProvider>
		)
	}
	return Object.assign(ScopeProvider, symbol)
}

export function useScope<Value>(scope: ScopeLike<Value>) {
	const { store, context } = use(ScopingProvider)
	const instance = store.resolve(context, scope)
	useEffect(() => store.mount(instance), [store, instance])
	return instance.value
}
