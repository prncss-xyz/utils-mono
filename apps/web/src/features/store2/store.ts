import { noop } from '@prncss-xyz/react-utils'

import {
  fromInit,
  isFunction,
  isReset,
  type SetStateWithReset,
} from '../store/functions'
import { sortedPush, sortedRemove } from './utils'

let count = 0

function call(cb: () => void) {
  cb()
}

function exhaustive(n: never): never {
  throw new Error(`unexpected value ${n}`)
}

type Instance<T> = {
  index: number
  type: AtomSymbol<any, any>['type']
  dirty: boolean
  value: T
  deps: Instance<any>[]
  subs: Instance<any>[]
  subscriptions: Set<() => void>
  count: number
}

type CoreSymbol = {
  index: number
}

export type PrimitiveSymbol<S, E> = CoreSymbol & {
  type: 'primitive'
  getter: (() => S) | S
  readonly event?: E
}

type DerivedSymbol<S, E> = CoreSymbol & {
  type: 'derived'
  getter: Getter<S>
  setter: Setter<E>
}

type EffectSymbol<S> = CoreSymbol & {
  type: 'effect'
  getter: Getter<S>
  doer: Doer<any>
}

export type AtomSymbol<S, E> =
  | PrimitiveSymbol<S, E>
  | DerivedSymbol<S, E>
  | EffectSymbol<S>

type Read = <T, E>(symbol: AtomSymbol<T, E>) => T
type Write = <T, E>(symbol: AtomSymbol<T, E>, e: E) => void
type Getter<T> = (read: Read) => T
type Setter<E> = (read: Read, write: Write, e: E) => void
type Doer<S> = (next: S | undefined, last: S | undefined) => void

// TODO: effect
// TODO: external
// TODO: family

export function primitive<V>(
  getter: V | (() => V),
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

export function effect<S>(
  getter: Getter<S>,
  doer: Doer<S>,
): AtomSymbol<void, never> {
  return {
    type: 'effect' as const,
    getter,
    doer,
    index: count++,
  }
}

type Tasks = {
  primitives: Map<PrimitiveSymbol<any, any>, any>
  effects: Set<EffectSymbol<any>>
}

export class Store {
  private contents = new WeakMap<AtomSymbol<any, any>, Instance<any>>()
  private tasks: Tasks | undefined = undefined
  constructor() { }
  private getTasks(): Tasks {
    if (this.tasks) return this.tasks
    this.tasks = {
      primitives: new Map(),
      effects: new Set(),
    }
    queueMicrotask(this.flush.bind(this))
    return this.tasks
  }
  private getInstance<R, S>(symbol: AtomSymbol<R, S>): Instance<R> {
    let instance = this.contents.get(symbol)
    if (instance) return instance
    instance = {
      index: symbol.index,
      type: symbol.type,
      dirty: symbol.type !== 'primitive',
      value:
        symbol.type === 'primitive'
          ? fromInit(symbol.getter)
          : (undefined as any),
      deps: [],
      subs: [],
      subscriptions: new Set(),
      count: 0,
    }
    this.contents.set(symbol, instance)
    return instance
  }
  private notify<S>(instance: Instance<S>) {
    if (instance.type === 'derived' || instance.type === 'effect')
      instance.dirty = true
    for (const sub of instance.subs) this.notify(sub)
    instance.subscriptions.forEach(call)
  }
  private updateValue<S, E>(
    symbol: DerivedSymbol<S, E> | EffectSymbol<S>,
    instance: Instance<S>,
  ) {
    for (const dep of instance.deps) {
      sortedRemove(instance.deps, dep)
      sortedRemove(dep.subs, instance)
    }
    instance.value = symbol.getter(<T, E>(s: AtomSymbol<T, E>) => {
      const dep = this.getInstance(s)
      sortedPush(instance.deps, dep)
      sortedPush(dep.subs, instance)
      return this.peek(s)
    })
  }
  send<S, E>(symbol: AtomSymbol<S, E>, next: E): void {
    switch (symbol.type) {
      case 'primitive': {
        const { primitives } = this.getTasks()
        let res: any
        if (isFunction(next)) {
          const last = primitives.has(symbol)
            ? primitives.get(symbol)
            : this.peek(symbol)
          res = next(last)
        } else if (isReset(next)) {
          res = fromInit(symbol.getter)
        } else {
          res = next
        }
        primitives.set(symbol, res)
        return
      }
      case 'derived': {
        symbol.setter(this.peek.bind(this), this.send.bind(this), next)
        return
      }
      case 'effect': {
        throw new Error('You cannot write to an effect')
      }
      default:
        return exhaustive(symbol)
    }
  }
  flush() {
    const { primitives, effects } = this.tasks!
    for (const effect of effects) {
      const instance = this.getInstance(effect)
      const last = instance.value
      this.updateValue(effect, instance)
      effect.doer(instance.value, last)
    }
    this.tasks = undefined
    // oxlint-disable-next-line prefer-const
    for (let [symbol, next] of primitives) {
      const instance = this.getInstance(symbol)
      if (!Object.is(next, instance.value)) {
        instance.value = next
        this.notify(instance)
      }
    }
  }
  peek<S, E>(symbol: AtomSymbol<S, E>) {
    const instance = this.getInstance(symbol)
    if (instance.dirty) {
      instance.dirty = false
      switch (symbol.type) {
        case 'primitive':
          instance.value = fromInit(symbol.getter)
          return instance.value
        case 'derived':
          this.updateValue(symbol, instance)
          return instance.value
        case 'effect':
          return undefined as S
        default:
          return exhaustive(symbol)
      }
    }
    return symbol.type === 'effect' ? (undefined as S) : instance.value
  }
  subscribe<S, E>(symbol: AtomSymbol<S, E>, notify: () => void): () => void {
    const instance = this.getInstance(symbol)
    instance.subscriptions.add(notify)
    return () => instance.subscriptions.delete(notify)
  }
}
