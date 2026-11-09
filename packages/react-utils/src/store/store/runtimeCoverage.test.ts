import { describe, expect, it, vi } from 'vitest'

import {
	atomFamily,
	derivedAtom,
	effectAtom,
	primitiveAtom,
	type Read,
	type AtomSymbol,
	type Store,
	type EffectAtom,
} from '.'
import { flush } from './flush'
import {
	countOperations,
	createStore,
	createStubState,
	flushMicrotask,
	inspect,
	mountCount,
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
		let unsubscribe = () => {}
		const child = primitiveAtom(1, {
			onMount: () => {
				events.push('child')
				unsubscribe()
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
		unsubscribe = store.subscribe(parent, () => {})
		store.send(flag, true)
		await flushMicrotask()

		expect(events).toEqual(['child', 'child cleanup'])
		expect(mountCount(store, parent)).toBe(0)
	})

	it('does not evaluate a released queued root after a commit', async () => {
		const source = primitiveAtom(0)
		const getter = vi.fn((read: Read) => read(source))
		const root = derivedAtom(getter)
		const store = createStore()
		const unsubscribe = store.subscribe(root, () => {})
		unsubscribe()
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
		const unsubscribe = store.subscribe(dependency, () => {})
		unsubscribe()
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
		const unsubscribe = store.subscribe(cached, () => {})
		await flushMicrotask()
		const validations = validationCount(store)
		store.send(unrelated, 1)
		await flushMicrotask()

		expect(store.peek(cached)).toBe(1)
		expect(validationCount(store)).toBe(validations)
		expect(getter).toHaveBeenCalledOnce()
		unsubscribe()
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
		expect(mountCount(store, resource)).toBe(0)
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
		let unsubscribeAgain = () => {}
		const create = vi.fn((key: string) =>
			primitiveAtom(key, {
				onMount: () => () => {
					if (remounted) return
					remounted = true
					unsubscribeAgain = store.subscribe(family, key, () => {})
				},
			}),
		)
		const family = atomFamily(create)
		const unsubscribe = store.subscribe(family, 'first', () => {})
		await flushMicrotask()
		unsubscribe()
		await flushMicrotask()

		expect(store.peek(family, 'first')).toBe('first')
		expect(create).toHaveBeenCalledOnce()
		unsubscribeAgain()
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
		let unsubscribeNewcomer = () => {}
		const newcomer = primitiveAtom(2, {
			onMount: () => {
				events.push('newcomer')
			},
		})
		const resource = primitiveAtom(1, {
			onMount: () => () => {
				events.push('cleanup')
				unsubscribeNewcomer = store.subscribe(newcomer, () => {})
			},
		})
		const flag = primitiveAtom(true)
		const middle = derivedAtom((read) => (read(flag) ? read(resource) : 0))
		const parent = derivedAtom((read) => read(middle))
		const unsubscribe = store.subscribe(parent, () => {})
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()

		expect(events).toEqual(['cleanup', 'newcomer'])
		unsubscribeNewcomer()
		unsubscribe()
	})

	it('does not release an old dependency twice when cleanup remounts its consumer', async () => {
		const store = createStore()
		const flag = primitiveAtom(true)
		let unsubscribe = () => {}
		let remounted = false
		const first = primitiveAtom(1, {
			onMount: () => () => {
				if (remounted) return
				remounted = true
				unsubscribe()
				unsubscribe = store.subscribe(parent, () => {})
			},
		})
		const secondMount = vi.fn()
		const second = primitiveAtom(2, { onMount: secondMount })
		const parent = derivedAtom((read) =>
			read(flag) ? read(first) + read(second) : 0,
		)
		unsubscribe = store.subscribe(parent, () => {})
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()

		expect(mountCount(store, second)).toBe(0)
		const unsubscribeSecond = store.subscribe(second, () => {})
		await flushMicrotask()
		expect(secondMount).toHaveBeenCalledTimes(2)
		unsubscribeSecond()
		unsubscribe()
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
		let unsubscribe = () => {}
		const mount = vi.fn(() => unsubscribe())
		const resource = primitiveAtom(1, { onMount: mount })
		const store = createStore()
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		unsubscribe = store.subscribe(resource, () => {})
		flush(state)

		expect(mount).toHaveBeenCalledOnce()
		expect(mountCount(store, resource)).toBe(0)
	})

	it('releases the final retained resource synchronously', () => {
		const cleanup = vi.fn()
		const resource = primitiveAtom(1, { onMount: () => cleanup })
		const store = createStore()
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		const unsubscribe = store.subscribe(resource, () => {})
		flush(state)

		unsubscribe()
		expect(cleanup).toHaveBeenCalledOnce()
		expect(mountCount(store, resource)).toBe(0)
		expect(state.tasks).toBeUndefined()
	})

	it('releases the dependencies of an effect that releases itself', () => {
		const cleanup = vi.fn()
		const resource = primitiveAtom(1, { onMount: () => cleanup })
		let unmount = () => {}
		const body = vi.fn((read: Read) => {
			read(resource)
			unmount()
		})
		const effect = effectAtom(body)
		const store = createStore()
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		unmount = store.mountEffect(effect)

		flush(state)
		expect(body).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()
		expect(state.instances.get(effect)?.mountCount).toBe(0)
		expect(mountCount(store, resource)).toBe(0)
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

	it('does not remount dependencies of a previous mount when an effect remounts', async () => {
		const mounts: string[] = []
		const flag = primitiveAtom(true)
		const recordedResource = (name: string) =>
			primitiveAtom(0, {
				onMount: () => {
					mounts.push(name)
				},
			})
		const first = recordedResource('first')
		const second = recordedResource('second')
		const effect = effectAtom((get) => {
			get(get(flag) ? first : second)
		})
		const store = createStore()
		const unmount = store.mountEffect(effect)
		await flushMicrotask()
		unmount()
		store.send(flag, false)
		const unmountAgain = store.mountEffect(effect)
		await flushMicrotask()

		expect(mounts).toEqual(['first', 'second'])
		expect(mountCount(store, first)).toBe(0)
		unmountAgain()
	})

	it('releases a resource dropped below an effect before mounting a new subscription', async () => {
		const events: string[] = []
		const flag = primitiveAtom(true)
		const dropped = primitiveAtom(0, {
			onMount: () => () => events.push('dropped cleanup'),
		})
		const newcomer = primitiveAtom(0, {
			onMount: () => {
				events.push('newcomer mount')
			},
		})
		const middle = derivedAtom((read) => (read(flag) ? read(dropped) : 0))
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom((get) => {
				get(middle)
			}),
		)
		await flushMicrotask()
		store.send(flag, false)
		const unsubscribeNewcomer = store.subscribe(newcomer, () => {})
		await flushMicrotask()

		expect(events).toEqual(['dropped cleanup', 'newcomer mount'])
		unsubscribeNewcomer()
		unmount()
	})

	it.each([1, 2])(
		'allows reversing ownership after an owner drops %i references to its child',
		(references) => {
			const stage = primitiveAtom(0)
			const parent: EffectAtom = effectAtom(
				(get) => get(stage),
				(value, _last, _get, _set, mountEffect) => {
					if (value === 0)
						for (let i = 0; i < references; i++) mountEffect(child)
				},
			)
			const child: EffectAtom = effectAtom(
				(get) => get(stage),
				(value, _last, _get, _set, mountEffect) => {
					if (value === 1) mountEffect(parent)
				},
			)
			const store = createStore()
			const state = inspect(store)
			state.scheduleFlush = vi.fn()
			const unmountParent = store.mountEffect(parent)
			const unmountChild = store.mountEffect(child)
			flush(state)
			store.send(stage, 1)

			expect(() => flush(state)).not.toThrow()
			expect(state.instances.get(parent)?.owners.size).toBe(1)
			expect(state.instances.get(child)?.owners.size).toBe(0)
			unmountChild()
			unmountParent()
		},
	)

	it('keeps a partially released owner reference visible to cycle checks', () => {
		const ownerRetained = primitiveAtom(true)
		const closeCycle = primitiveAtom(false)
		const base = primitiveAtom(0)
		const middle = derivedAtom((read): number =>
			read(closeCycle) ? read(owner) : read(base),
		)
		const reader = effectAtom((get) => {
			get(middle)
		})
		const store = createStore()
		const probeDuringRelease = effectAtom(() => () => {
			store.peek(middle)
		})
		const owner = primitiveAtom(0, {
			onMount: (_get, _set, mountEffect) => {
				mountEffect(reader)
				mountEffect(probeDuringRelease)
				mountEffect(reader)
			},
		})
		const ownerConsumer = derivedAtom((read) =>
			read(ownerRetained) ? read(owner) : 0,
		)
		const state = inspect(store)
		state.scheduleFlush = vi.fn()
		store.subscribe(ownerConsumer, () => {})
		flush(state)
		store.send(ownerRetained, false)
		store.send(closeCycle, true)

		expect(() => flush(state)).toThrow('cyclic effect ownership')
	})

	it('does not track a read made after an effect releases itself during its body', async () => {
		const mount = vi.fn()
		const resource = primitiveAtom(4, { onMount: mount })
		const values: number[] = []
		let unmount = () => {}
		const store = createStore()
		unmount = store.mountEffect(
			effectAtom((get) => {
				unmount()
				values.push(get(resource))
			}),
		)
		await flushMicrotask()

		expect(values).toEqual([4])
		expect(mount).not.toHaveBeenCalled()
		expect(mountCount(store, resource)).toBe(0)
	})

	it('runs an effect remounted by its own cleanup after the effects already queued', async () => {
		const source = primitiveAtom(0)
		const events: string[] = []
		const store = createStore()
		let unmount = () => {}
		let remount = false
		const first: EffectAtom = effectAtom((get) => {
			events.push(`first ${get(source)}`)
			return () => {
				if (!remount) return
				remount = false
				unmount()
				unmount = store.mountEffect(first)
			}
		})
		unmount = store.mountEffect(first)
		const unmountSecond = store.mountEffect(
			effectAtom((get) => {
				events.push(`second ${get(source)}`)
			}),
		)
		await flushMicrotask()
		remount = true
		store.send(source, 1)
		await flushMicrotask()

		expect(events).toEqual(['first 0', 'second 0', 'second 1', 'first 1'])
		unmountSecond()
		unmount()
	})

	it('does not track reads through the getter of a previous run', async () => {
		const source = primitiveAtom(0)
		const mount = vi.fn()
		const resource = primitiveAtom(5, { onMount: mount })
		const getters: Read[] = []
		const values: number[] = []
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom((get) => {
				getters.push(get)
				if (get(source) === 1) values.push(getters[0]!(resource))
			}),
		)
		await flushMicrotask()
		store.send(source, 1)
		await flushMicrotask()

		expect(values).toEqual([5])
		expect(mount).not.toHaveBeenCalled()
		unmount()
	})

	it('mounts a subscription created by an effect body in the same flush', async () => {
		const mount = vi.fn()
		const resource = primitiveAtom(0, { onMount: mount })
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom(() => store.subscribe(resource, () => {})),
		)
		await flushMicrotask()

		expect(mount).toHaveBeenCalledOnce()
		unmount()
	})
})
