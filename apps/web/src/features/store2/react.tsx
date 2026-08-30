'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import type { SetStateWithReset } from '../store/functions'
import {
  primitive,
  Store,
  type AtomSymbol,
  type PrimitiveSymbol,
} from './store'

export const StoreCtx = createContext(Store.init())

export function Override<S>({
  target,
  value,
  children,
}: {
  target: PrimitiveSymbol<S, SetStateWithReset<S>>
  value: S
  children: ReactNode
}) {
  const [source] = useState(() => primitive(value))
  const setValue = useSetAtom(source)
  useEffect(() => setValue(value), [value, setValue])
  const baseStore = useContext(StoreCtx)
  const [nextStore] = useState(baseStore.substore(target, source))
  return <StoreCtx value={nextStore}> {children} </StoreCtx>
}

export function useAtomValue<V>(atom: AtomSymbol<V, any>): V {
  const store = useContext(StoreCtx)
  const peek = () => store.peek(atom)
  const res = useSyncExternalStore(
    (notify: () => void) => store.subscribe(atom, notify),
    peek,
    peek,
  )
  return res
}

export function useSetAtom<V, E>(atom: AtomSymbol<V, E>) {
  const store = useContext(StoreCtx)
  return (e: E) => store.send(atom, e)
}

export function useAtom<V, E>(atom: AtomSymbol<V, E>) {
  return [useAtomValue(atom), useSetAtom(atom)] as const
}
