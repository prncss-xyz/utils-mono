// oxlint-disable no-console
import { isFunction, isReset, type SetStateWithReset } from '../store/functions'
import { addScope, sortedPush, sortedRemove } from './utils'

type Scope = [AtomSymbol<any, any>, any][]

let count = 0

type Instance<T> = {
  index: number
  symbol: AtomSymbol<T, any>
  getter: Getter<T> | T
  type: 'primitive' | 'derived'
  value: T
  scope: Scope
  deps: Instance<any>[]
  subs: Instance<any>[]
}

// TODO: will eventually be a tree
type Lattice<T> = Instance<T>[]

type CoreSymbol = {
  index: number
}

type PrimitiveSymbol<S, E> = CoreSymbol & {
  type: 'primitive'
  getter: Getter<S> | S
  readonly event?: E
}

type DerivedSymbol<S, E> = CoreSymbol & {
  type: 'derived'
  getter: Getter<S>
  setter: Setter<E>
}

export type AtomSymbol<S, E> = PrimitiveSymbol<S, E> | DerivedSymbol<S, E>

type Read = <T, E>(symbol: AtomSymbol<T, E>) => T
type Write = <T, E>(symbol: AtomSymbol<T, E>, e: E) => void
type Getter<T> = (read: Read) => T
type Setter<E> = (read: Read, write: Write, e: E) => void

// TODO: override
// TODO: effect
// TODO: family

export function primitive<V>(
  getter: V | Getter<V>,
): PrimitiveSymbol<V, SetStateWithReset<V>> {
  return {
    type: 'primitive' as const,
    getter,
    index: count++,
  }
}

export function derived<V, E>(
  getter: Getter<V>,
  setter: Setter<E>,
): DerivedSymbol<V, E> {
  return {
    type: 'derived' as const,
    getter,
    setter,
    index: count++,
  }
}

function call(cb: () => void) {
  cb()
}

export class Store {
  private contents
  private subscriptions
  private primitiveSendQueue: (() => Instance<any>)[] = []
  private primitiveSendScheduled = false
  constructor(opts: {
    contents: WeakMap<AtomSymbol<any, any>, Lattice<any>>
    subscriptions: WeakMap<AtomSymbol<any, any>, Set<() => void>>
  }) {
    this.contents = opts.contents
    this.subscriptions = opts.subscriptions
  }
  static init() {
    return new Store({
      contents: new WeakMap<AtomSymbol<any, any>, Lattice<any>>(),
      subscriptions: new WeakMap<AtomSymbol<any, any>, Set<() => void>>(),
    })
  }
  private findInstance<R, S>(symbol: AtomSymbol<R, S>) {
    const content = this.contents.get(symbol)
    if (!content) return
    outer: for (const row of content) {
      for (const [k, v] of row.scope) {
        if (!this.findInstance(k)) continue outer
        if (!Object.is(this.findInstance(k)?.value, v)) continue outer
      }
      return row as Instance<R>
    }
  }
  getInstance<R, S>(symbol: AtomSymbol<R, S>): Instance<R> {
    const instance = this.findInstance(symbol)
    if (instance) return instance
    const scope: Scope = []
    const deps: Instance<any>[] = []
    const subs: Instance<any>[] = []
    const res = {
      index: symbol.index,
      symbol,
      type: symbol.type,
      getter: symbol.getter,
      scope,
      deps,
      subs,
    } as Instance<R>
    const read = <T, E>(s: AtomSymbol<T, E>) => {
      const source = this.getInstance(s)
      if (symbol.type === 'primitive') addScope(scope, s, source.value)
      else {
        sortedPush(res.deps, source)
        sortedPush(source.subs, res)
        for (const [atom, value] of source.scope) {
          addScope(scope, atom, value)
        }
      }
      return source.value
    }
    const getter = symbol.getter
    res.value = isFunction(getter) ? getter(read) : getter
    const content = this.contents.get(symbol)
    if (content) content.push(res)
    else this.contents.set(symbol, [res])
    return res
  }
  private removeInstance(instance: Instance<any>) {
    const content = this.contents.get(instance.symbol)
    const index = content?.indexOf(instance) ?? -1
    if (index !== -1) content?.splice(index, 1)
    for (const dep of instance.deps) sortedRemove(dep.subs, instance)
  }
  private notify<S>(instance: Instance<S>) {
    this.subscriptions.get(instance.symbol)?.forEach(call)
    for (const sub of [...instance.subs]) {
      this.removeInstance(sub)
      this.notify(sub)
    }
  }
  private enqueuePrimitiveSend(mutation: () => Instance<any>) {
    this.primitiveSendQueue.push(mutation)
    if (this.primitiveSendScheduled) return
    this.primitiveSendScheduled = true
    queueMicrotask(() => this.flushPrimitiveSends())
  }
  private flushPrimitiveSends() {
    const mutations = this.primitiveSendQueue
    this.primitiveSendQueue = []
    this.primitiveSendScheduled = false
    const affected: Instance<any>[] = []
    const affectedSet = new Set<Instance<any>>()
    for (const mutation of mutations) {
      const instance = mutation()
      if (affectedSet.has(instance)) continue
      affectedSet.add(instance)
      affected.push(instance)
    }
    for (const instance of affected) this.notify(instance)
  }
  send<S, E>(symbol: AtomSymbol<S, E>, e: E): void {
    if (symbol.type === 'primitive') {
      this.enqueuePrimitiveSend(() => {
        const instance = this.getInstance(symbol)
        const res = isFunction(e) ? e(instance.value) : e
        if (isReset(res)) this.removeInstance(instance)
        else instance.value = res
        return instance
      })
      return
    }
    symbol.setter(this.peek.bind(this), this.send.bind(this), e)
  }
  peek<S, E>(symbol: AtomSymbol<S, E>) {
    return this.getInstance(symbol).value
  }
  subscribe<S, E>(symbol: AtomSymbol<S, E>, notify: () => void): () => void {
    const subscriptions = this.subscriptions.get(symbol) ?? new Set()
    subscriptions.add(notify)
    this.subscriptions.set(symbol, subscriptions)
    return () => subscriptions.delete(notify)
  }
}
