import type { OnMount, Teardown } from './mount'

export function noWrite(...args: [never]): never {
	throw new Error(`Cannot write ${args} to a read-only store`)
}

interface IAtomInstance<Value, Args extends any[], Result> {
	send(...args: Args): Result
	subscribe(cb: () => void): () => void
	peek(): Value
}

export abstract class AtomInstance<
	Value,
	Args extends any[],
	Result,
> implements IAtomInstance<Value, Args, Result> {
	private uOnMount
	private uUnmount: Teardown = undefined
	abstract send(...args: Args): Result
	abstract subscribe(cb: () => void): () => void
	abstract peek(): Value
	readonly index
	private count = 0
	constructor(onMount?: OnMount) {
		this.uOnMount = onMount
		this.index = ++this.count
	}
	protected mount() {
		this.uUnmount = this.uOnMount?.()
	}
	protected unmount() {
		this.uUnmount?.()
	}
}
