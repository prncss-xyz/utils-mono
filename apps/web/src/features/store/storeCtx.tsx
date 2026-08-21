import { createContext, type ReactNode } from 'react'

import { createStore } from './store'

export const StoreCtx = createContext(createStore())

export function AtomProvider({ children }: { children: ReactNode }) {
	return <StoreCtx value={createStore()}>{children}</StoreCtx>
}
