import { useContext, type ReactNode } from 'react'

import { noWrite } from './atomInstance'
import type { OnMount } from './mount'
import type { Store } from './store'
import { StoreCtx } from './storeCtx'
import { Subscribed } from './subscribed'

export function scope<Value>() {
	function Scope({ children, value }: { children: ReactNode; value: Value }) {
		const store = useContext(StoreCtx)
		return (
			<StoreCtx value={store.sub(Scope, new ScopeInstance(value))}>
				{children}
			</StoreCtx>
		)
	}
	Scope.instance = (store: Store, _: void): ScopeInstance<Value> => {
		return store.value(Scope)
	}
	return Scope
}

class ScopeInstance<Value> extends Subscribed<Value, [x: never], void> {
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
