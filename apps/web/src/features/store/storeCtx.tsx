import { createContext, type ReactNode } from 'react'

import { Store } from './store'

export const StoreCtx = createContext<Store>(new Store())

export function AtomProvider({ children }: { children: ReactNode }) {
	return <StoreCtx value={new Store()}>{children}</StoreCtx>
}
