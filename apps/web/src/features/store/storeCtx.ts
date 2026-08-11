import { createContext } from 'react'

import { Store } from './primitive'

export const StoreCtx = createContext<Store>(new Store())
