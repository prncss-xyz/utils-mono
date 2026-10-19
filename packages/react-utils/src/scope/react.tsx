import {
	createContext,
	use,
	useEffect,
	useState,
	type FC,
	type ReactNode,
} from 'react'

import { isoAssert } from '../functions'
import {
	primitiveScope as corePrimitiveScope,
	ScopeContext,
	ScopeStore,
	type OnMount,
	type PrimitiveScopeSymbol,
	type ScopeLike,
} from './core'

export const ScopingProvider = createContext<{
	store: ScopeStore
	context: ScopeContext
} | null>(null)

function useScopeContext() {
	const context = use(ScopingProvider)
	isoAssert(
		context,
		'Scope providers and useScope must be used within RootScope',
	)
	return context
}

export function RootScope({ children }: Readonly<{ children: ReactNode }>) {
	const [root] = useState(() => ({
		store: new ScopeStore(),
		context: ScopeContext.init(),
	}))
	useEffect(() => root.store.mountStore(), [root])
	return <ScopingProvider value={root}>{children}</ScopingProvider>
}

type Props<Value> = Readonly<{
	value: Value
	children: ReactNode
}>

export function primitiveScope<Value>(
	onMount?: OnMount<Value>,
): FC<Props<Value>> & PrimitiveScopeSymbol<Value> {
	const symbol = corePrimitiveScope(onMount)
	function ScopeProvider({ value, children }: Props<Value>) {
		const { store, context } = useScopeContext()
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
	const { store, context } = useScopeContext()
	const instance = store.resolve(context, scope)
	useEffect(() => store.mount(instance), [store, instance])
	return instance.value
}
