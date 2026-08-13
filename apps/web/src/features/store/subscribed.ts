import { AtomInstance } from './atomInstance'

export abstract class Subscribed<
	Value,
	Args extends any[],
	Result,
> extends AtomInstance<Value, Args, Result> {
	private subscribers = new Set<() => void>()
	subscribe(cb: () => void) {
		if (this.subscribers.size === 0) this.mount()
		this.subscribers.add(cb)
		return () => {
			this.subscribers.delete(cb)
			if (this.subscribers.size === 0) this.unmount()
		}
	}
	isMounted() {
		return this.subscribers.size > 0
	}
	notify() {
		this.subscribers.forEach((cb) => cb())
	}
}
