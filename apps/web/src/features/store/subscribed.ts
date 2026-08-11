import { Store } from './store'

export abstract class Subscribed<
	Value,
	Args extends any[],
	Result,
> extends Store<Value, Args, Result> {
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
	protected notify() {
		this.subscribers.forEach((cb) => cb())
	}
}

export abstract class Counted<Value, Args extends any[], Result> extends Store<
	Value,
	Args,
	Result
> {
	private size = 0
	isMounted() {
		return this.size > 0
	}
	subscribe() {
		if (this.size === 0) this.mount()
		this.size++
		return () => {
			this.size--
			if (this.size === 0) this.unmount()
		}
	}
}
