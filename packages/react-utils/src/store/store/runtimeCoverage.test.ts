import { describe, expect, it, vi } from 'vitest'

import {
	atomFamily,
	derivedAtom,
	effectAtom,
	primitiveAtom,
	type Read,
	type AtomSymbol,
	type Store,
} from '.'
import { flush } from './flush'
import {
	countOperations,
	createStore,
	createStubState,
	flushMicrotask,
	inspect,
	type Instrumentation,
} from './utils.testing'
import { dispatch } from './write'

const instrumented = new WeakMap<Store, Instrumentation>()

function validationCount(store: Store) {
	let instrumentation = instrumented.get(store)
	if (!instrumentation) {
		instrumentation = countOperations(store)
		instrumented.set(store, instrumentation)
	}
	return instrumentation.totals.validations
}

describe('runtime lifecycle scenarios', () => {
	it('does not mount an ancestor released by a dependency mount', async () => {
		const events: string[] = []
		const flag = primitiveAtom(false)
		let release = () => {}
		const child = primitiveAtom(1, {
			onMount: () => {
				events.push('child')
				release()
				return () => events.push('child cleanup')
			},
		})
		const parent = derivedAtom(
			(read) => (read(flag) ? read(child) : 0),
			undefined,
			{
				onMount: () => {
					events.push('parent')
					return () => events.push('parent cleanup')
				},
			},
		)
		const store = createStore()
		release = store.subscribe(parent, () => {})
		store.send(flag, true)
		await flushMicrotask()

		expect(events).toEqual(['child', 'child cleanup'])
		expect(
			inspect(store).instances.get(parent as AtomSymbol<any, any>)?.mountCount,
		).toBe(0)
	})

	it('does not evaluate a released queued root after a commit', async () => {
		const source = primitiveAtom(0)
		const getter = vi.fn((read: Read) => read(source))
		const root = derivedAtom(getter)
		const store = createStore()
		const release = store.subscribe(root, () => {})
		release()
		store.send(source, 1)

		await flushMicrotask()

		expect(getter).toHaveBeenCalledOnce()
	})

	it('remounts a released queued dependency before a later consumer', async () => {
		const events: string[] = []
		const store = createStore()
		const dependency = primitiveAtom(1, {
			onMount: () => {
				events.push('dependency')
			},
		})
		const consumer = derivedAtom((read) => read(dependency), undefined, {
			onMount: () => {
				events.push('consumer')
			},
		})
		const writer = primitiveAtom(0, {
			onMount: () => {
				store.subscribe(consumer, () => {})
			},
		})
		const release = store.subscribe(dependency, () => {})
		release()
		store.subscribe(writer, () => {})

		await flushMicrotask()

		expect(events).toEqual(['dependency', 'consumer'])
	})

	it('keeps a clean mounted cache fresh across unrelated commits', async () => {
		const source = primitiveAtom(1)
		const unrelated = primitiveAtom(0)
		const getter = vi.fn((read: Read) => read(source))
		const cached = derivedAtom(getter)
		const store = createStore()
		const release = store.subscribe(cached, () => {})
		await flushMicrotask()
		const validations = validationCount(store)
		store.send(unrelated, 1)
		await flushMicrotask()

		expect(store.peek(cached)).toBe(1)
		expect(validationCount(store)).toBe(validations)
		expect(getter).toHaveBeenCalledOnce()
		release()
	})

	it('validates an unmounted cache once per epoch without evaluating unchanged dependencies', async () => {
		const source = primitiveAtom(1)
		const unrelated = primitiveAtom(0)
		const getter = vi.fn((read: Read) => read(source))
		const cached = derivedAtom(getter)
		const store = createStore()
		expect(store.peek(cached)).toBe(1)
		const validations = validationCount(store)
		store.send(unrelated, 1)
		await flushMicrotask()

		expect(store.peek(cached)).toBe(1)
		expect(validationCount(store) - validations).toBe(1)
		expect(store.peek(cached)).toBe(1)
		expect(validationCount(store) - validations).toBe(1)
		expect(getter).toHaveBeenCalledOnce()
	})

	it('stops validation at the first known changed dependency', async () => {
		const first = primitiveAtom(1)
		const second = primitiveAtom(2)
		const middle = derivedAtom((read) => read(first))
		const getter = vi.fn(
			(read: Read) => read(first) + read(middle) + read(second),
		)
		const cached = derivedAtom(getter)
		const store = createStore()
		expect(store.peek(cached)).toBe(4)
		store.send(first, 3)
		await flushMicrotask()
		const validations = validationCount(store)

		expect(store.peek(cached)).toBe(8)
		expect(validationCount(store) - validations).toBe(2)
		expect(getter).toHaveBeenCalledTimes(2)
	})

	it('does not retain resources during an unmounted recomputation', async () => {
		const mount = vi.fn()
		const resource = primitiveAtom(2, { onMount: mount })
		const cached = derivedAtom((read) => read(resource))
		const store = createStore()

		expect(store.peek(cached)).toBe(2)
		await flushMicrotask()
		expect(mount).not.toHaveBeenCalled()
		expect(inspect(store).instances.get(resource)?.mountCount).toBe(0)
	})

	it('stores short string keys in equality families', async () => {
		const create = vi.fn((key: string) => primitiveAtom(key))
		const family = atomFamily(create, { eq: (a, b) => a === b, TTL: Infinity })
		const store = createStore()

		expect(store.peek(family, 'S')).toBe('S')
		expect(store.peek(family, 'S')).toBe('S')
		expect(create).toHaveBeenCalledOnce()
		await flushMicrotask()
	})

	it('keeps a family member remounted by its own cleanup', async () => {
		const store = createStore()
		let remounted = false
		let releaseAgain = () => {}
		const create = vi.fn((key: string) =>
			primitiveAtom(key, {
				onMount: () => () => {
					if (remounted) return
					remounted = true
					releaseAgain = store.subscribe(family, key, () => {})
				},
			}),
		)
		const family = atomFamily(create)
		const release = store.subscribe(family, 'first', () => {})
		await flushMicrotask()
		release()
		await flushMicrotask()

		expect(store.peek(family, 'first')).toBe('first')
		expect(create).toHaveBeenCalledOnce()
		releaseAgain()
		await flushMicrotask()
	})

	it('keeps an evicted primitive symbol readable through its direct handle', async () => {
		const member = primitiveAtom(7)
		const family = atomFamily((_key: string) => member)
		const store = createStore()
		expect(store.peek(family, 'first')).toBe(7)
		const handle = store.resolve(member)
		await flushMicrotask()

		expect(handle.peek()).toBe(7)
		expect(store.peek(member)).toBe(7)
	})

	it('drops cached dependency references when a derived member is evicted', async () => {
		const resource = primitiveAtom(3)
		const member = derivedAtom((read) => read(resource))
		const family = atomFamily((_key: string) => member)
		const store = createStore()
		expect(store.peek(family, 'first')).toBe(3)
		const instance = inspect(store).instances.get(
			member as AtomSymbol<any, any>,
		)!
		expect(instance.depVersions.size).toBe(1)
		await flushMicrotask()

		expect(instance.depVersions.size).toBe(0)
		expect(store.peek(member)).toBe(3)
	})

	it('mounts resources retained by a deferred cleanup before leaving settle', async () => {
		const events: string[] = []
		const store = createStore()
		let releaseNewcomer = () => {}
		const newcomer = primitiveAtom(2, {
			onMount: () => {
				events.push('newcomer')
			},
		})
		const resource = primitiveAtom(1, {
			onMount: () => () => {
				events.push('cleanup')
				releaseNewcomer = store.subscribe(newcomer, () => {})
			},
		})
		const flag = primitiveAtom(true)
		const middle = derivedAtom((read) => (read(flag) ? read(resource) : 0))
		const parent = derivedAtom((read) => read(middle))
		const release = store.subscribe(parent, () => {})
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()

		expect(events).toEqual(['cleanup', 'newcomer'])
		releaseNewcomer()
		release()
	})

	it('does not release an old dependency twice when cleanup remounts its consumer', async () => {
		const store = createStore()
		const flag = primitiveAtom(true)
		let release = () => {}
		let remounted = false
		const first = primitiveAtom(1, {
			onMount: () => () => {
				if (remounted) return
				remounted = true
				release()
				release = store.subscribe(parent, () => {})
			},
		})
		const secondMount = vi.fn()
		const second = primitiveAtom(2, { onMount: secondMount })
		const parent = derivedAtom((read) =>
			read(flag) ? read(first) + read(second) : 0,
		)
		release = store.subscribe(parent, () => {})
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()

		expect(inspect(store).instances.get(second)?.mountCount).toBe(0)
		const releaseSecond = store.subscribe(second, () => {})
		await flushMicrotask()
		expect(secondMount).toHaveBeenCalledTimes(2)
		releaseSecond()
		release()
	})

	it('does not schedule a flush when a command only reads committed values', async () => {
		const source = primitiveAtom(1)
		const readValue = vi.fn()
		const command = derivedAtom(null, (read) => readValue(read(source)))
		const store = createStore()
		const scheduled = vi.spyOn(inspect(store), 'scheduleFlush')

		store.send(command)
		expect(readValue).toHaveBeenCalledWith(1)
		expect(scheduled).not.toHaveBeenCalled()
		await flushMicrotask()
	})

	it('skips validation of a dependency whose version already changed', async () => {
		const source = primitiveAtom(1)
		const unrelated = primitiveAtom(0)
		const dependency = derivedAtom((read) => read(source))
		let useDependency = true
		const cached = derivedAtom((read) => (useDependency ? read(dependency) : 0))
		const store = createStore()
		expect(store.peek(cached)).toBe(1)
		store.send(source, 2)
		await flushMicrotask()
		expect(store.peek(dependency)).toBe(2)
		store.send(unrelated, 1)
		await flushMicrotask()
		useDependency = false
		const validations = validationCount(store)

		expect(store.peek(cached)).toBe(0)
		expect(validationCount(store) - validations).toBe(1)
	})

	it('allows an onMount without cleanup to release itself', () => {
		let release = () => {}
		const mount = vi.fn(() => release())
		const resource = primitiveAtom(1, { onMount: mount })
		const store = createStore()
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		release = store.subscribe(resource, () => {})
		flush(state)

		expect(mount).toHaveBeenCalledOnce()
		expect(inspect(store).instances.get(resource)?.mountCount).toBe(0)
	})

	it('releases the final retained resource synchronously', () => {
		const cleanup = vi.fn()
		const resource = primitiveAtom(1, { onMount: () => cleanup })
		const store = createStore()
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		const release = store.subscribe(resource, () => {})
		flush(state)

		release()
		expect(cleanup).toHaveBeenCalledOnce()
		expect(state.instances.get(resource)?.mountCount).toBe(0)
		expect(state.tasks).toBeUndefined()
	})

	it('allows an effect without cleanup to release itself', () => {
		let release = () => {}
		const body = vi.fn(() => release())
		const effect = effectAtom(body)
		const store = createStore()
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		release = store.mountEffect(effect)

		flush(state)
		expect(body).toHaveBeenCalledOnce()
		expect(state.instances.get(effect)?.mountCount).toBe(0)
	})

	it('releases the dependencies of an effect that releases itself', () => {
		const cleanup = vi.fn()
		const resource = primitiveAtom(1, { onMount: () => cleanup })
		let release = () => {}
		const body = vi.fn((read: Read) => {
			read(resource)
			release()
		})
		const effect = effectAtom(body)
		const store = createStore()
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		release = store.mountEffect(effect)

		flush(state)
		expect(body).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()
		expect(state.instances.get(effect)?.mountCount).toBe(0)
		expect(state.instances.get(resource)?.mountCount).toBe(0)
	})

	it('hydrates pending values without scheduling a second flush', () => {
		const source = primitiveAtom(0)
		const state = createStubState()
		const schedule = vi.fn()
		state.scheduleFlush = schedule

		dispatch(state, source, [1])
		expect(schedule).not.toHaveBeenCalled()
		flush(state)
		expect(state.instances.get(source)?.value).toBe(1)
	})

	it('invalidates direct consumers across member eviction and recomputation', async () => {
		const source = primitiveAtom(1)
		const member = derivedAtom((read) => read(source))
		const family = atomFamily((_key: string) => member)
		const consumer = derivedAtom((read) => read(member) + 10)
		const store = createStore()
		expect(store.peek(family, 'first')).toBe(1)
		expect(store.peek(consumer)).toBe(11)
		await flushMicrotask()
		store.send(source, 2)
		await flushMicrotask()

		expect(store.peek(member)).toBe(2)
		expect(store.peek(consumer)).toBe(12)
	})
})
