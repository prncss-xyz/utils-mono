import {
  fromInit,
  isFunction,
  isReset,
  type SetStateWithReset,
} from '../store/functions'
import { sortedPush, sortedRemove } from './utils'

let nextIndex = 0

function call(cb: () => void) {
  cb()
}

function exhaustive(n: never): never {
  throw new Error(`unexpected value ${n}`)
}

type Instance<T> = {
  symbol: AtomSymbol<any, any>
  dirty: boolean
  value: T
  effectValue: T | undefined
  effectCleanup: (() => void) | undefined
  deps: Instance<any>[]
  subs: Instance<any>[]
  subscriptions: Set<() => void>
  mounted: boolean
}

type CoreSymbol<S> = {
  index: number
  effect?: Effect<S>
}

export type PrimitiveSymbol<S, E> = CoreSymbol<S> & {
  type: 'primitive'
  getter: (() => S) | S
  readonly event?: E
}

type DerivedSymbol<S, E> = CoreSymbol<S> & {
  type: 'derived'
  getter: Getter<S>
  setter: Setter<E>
}

export type AtomSymbol<S, E> = PrimitiveSymbol<S, E> | DerivedSymbol<S, E>

type Read = <T, E>(symbol: AtomSymbol<T, E>) => T
type Write = <T, E>(symbol: AtomSymbol<T, E>, e: E) => void
type Getter<T> = (read: Read) => T
type Setter<E> = (read: Read, write: Write, e: E) => void
type Effect<S> = (
  next: S | undefined,
  last: S | undefined,
) => void | (() => void)

// TODO: family
// TODO: minimize symbol-instance handoffs
// TODO: scope

export function primitive<V>(
  getter: V | (() => V),
  effect?: Effect<NoInfer<V>>,
): PrimitiveSymbol<V, SetStateWithReset<V>> {
  return {
    type: 'primitive' as const,
    getter,
    effect,
    index: nextIndex++,
  }
}

export function derived<V, E>(
  getter: Getter<V>,
  setter: Setter<E>,
  effect?: Effect<NoInfer<V>>,
): DerivedSymbol<V, E> {
  return {
    type: 'derived' as const,
    getter,
    setter,
    effect,
    index: nextIndex++,
  }
}

type Tasks = {
  primitives: Map<PrimitiveSymbol<any, any>, any>
  effects: Set<AtomSymbol<any, any>>
}

export class Store {
  private contents = new WeakMap<AtomSymbol<any, any>, Instance<any>>()
  private tasks: Tasks | undefined = undefined
  private flushingEffects: Set<AtomSymbol<any, any>> | undefined
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
      symbol,
      dirty: symbol.type === 'derived',
      value:
        symbol.type === 'primitive'
          ? fromInit(symbol.getter)
          : (undefined as any),
      effectValue: undefined,
      effectCleanup: undefined,
      deps: [],
      subs: [],
      subscriptions: new Set(),
      mounted: false,
    }
    this.contents.set(symbol, instance)
    return instance
  }
  private enqueueEffect(symbol: AtomSymbol<any, any>) {
    if (!symbol.effect) return
    if (this.flushingEffects) {
      this.flushingEffects.add(symbol)
      return
    }
    this.getTasks().effects.add(symbol)
  }
  private notify<S>(instance: Instance<S>) {
    if (instance.symbol.type === 'derived') instance.dirty = true
    if (instance.mounted) this.enqueueEffect(instance.symbol)
    for (const sub of instance.subs) this.notify(sub)
    instance.subscriptions.forEach(call)
  }
  private isMounted(instance: Instance<any>) {
    return (
      instance.subscriptions.size > 0 ||
      (instance.symbol.type === 'derived' &&
        instance.deps.some((dependency) => dependency.mounted))
    )
  }
  private updateMounted(instance: Instance<any>) {
    const mounted = this.isMounted(instance)
    if (mounted === instance.mounted) return
    instance.mounted = mounted
    if (mounted) this.enqueueEffect(instance.symbol)
    else this.detachEffect(instance)
    for (const sub of instance.subs) this.updateMounted(sub)
  }
  private updateValue<S, E>(
    symbol: DerivedSymbol<S, E>,
    instance: Instance<S>,
  ) {
    for (const dep of instance.deps) sortedRemove(dep.subs, instance)
    instance.deps = []
    instance.value = symbol.getter(<T, E>(s: AtomSymbol<T, E>) => {
      const dep = this.getInstance(s)
      sortedPush(instance.deps, dep)
      sortedPush(dep.subs, instance)
      return this.peek(s)
    })
    this.updateMounted(instance)
  }
  private detachEffect<S>(instance: Instance<S>) {
    const { effect } = instance.symbol
    if (!effect) return
    const last = instance.effectValue
    instance.effectValue = undefined
    instance.effectCleanup?.()
    instance.effectCleanup = effect(undefined, last) || undefined
  }
  private runEffect<S>(symbol: AtomSymbol<S, any>, instance: Instance<S>) {
    const next = this.peek(symbol)
    if (!instance.mounted) return
    const last = instance.effectValue
    instance.effectValue = next
    instance.effectCleanup?.()
    instance.effectCleanup = symbol.effect?.(next, last) || undefined
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
      default:
        return exhaustive(symbol)
    }
  }
  private flush() {
    const { primitives, effects } = this.tasks!
    this.tasks = undefined
    this.flushingEffects = effects
    // oxlint-disable-next-line prefer-const
    for (let [symbol, next] of primitives) {
      const instance = this.getInstance(symbol)
      if (!Object.is(next, instance.value)) {
        instance.value = next
        this.notify(instance)
      }
    }
    this.flushingEffects = undefined
    for (const symbol of effects) {
      const instance = this.getInstance(symbol)
      if (instance.mounted) this.runEffect(symbol, instance)
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
        default:
          return exhaustive(symbol)
      }
    }
    return instance.value
  }
  subscribe<S, E>(symbol: AtomSymbol<S, E>, notify: () => void): () => void {
    const instance = this.getInstance(symbol)
    instance.subscriptions.add(notify)
    this.updateMounted(instance)
    return () => {
      instance.subscriptions.delete(notify)
      this.updateMounted(instance)
    }
  }
}
