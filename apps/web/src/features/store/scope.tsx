import { useContext, type ReactNode } from 'react'

import { noWrite } from './atomInstance'
import type { OnMount } from './mount'
import type { Store } from './store'
import { StoreCtx } from './storeCtx'
import { Subscribed } from './subscribed'

export function scope<Value>() {
	return (store: Store, _: void): ValueInstance<Value> => {
		return store.value(Scope)
	}
}

type Scope<Value> = ReturnType<typeof scope<Value>>

export function Scope<Value>({
	children,
	scope,
	value,
}: {
	children: ReactNode
	scope: Scope<Value>
	value: Value
}) {
	const store = useContext(StoreCtx)
	return (
		<StoreCtx value={store.sub(scope, new ValueInstance(value))}>
			{children}
		</StoreCtx>
	)
}

class ValueInstance<Value> extends Subscribed<Value, [x: never], void> {
	private init
	constructor(init: Value, onMount?: OnMount) {
		super(onMount)
		this.init = init
	}
	send(x: never) {
		return noWrite(x)
	}
	peek() {
		return this.init
	}
}
