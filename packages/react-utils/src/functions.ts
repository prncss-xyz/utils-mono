export function noop(..._args: unknown[]): void { }

export function id<T>(t: T) {
  return t
}

export function exhaustive(n: never): never {
  throw new Error(`unexpected value ${n}`)
}
