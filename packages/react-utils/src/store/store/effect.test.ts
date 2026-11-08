import { describe, expect, it, vi } from 'vitest'

import {
	atomFamily,
	derivedAtom,
	effectAtom,
	hydrate,
	primitiveAtom,
	type EffectAtom,
	type MountEffect,
	type Read,
} from '.'
import { flush } from './flush'
import { createStore, flushMicrotask, inspect } from './utils.testing'

const manualStore = () => {
	const store = createStore()
	const state = inspect(store)
	state.scheduleFlush = () => {}
	return { store, flush: () => flush(state) }
}

describe('effect atoms', () => {
	it('provides previous selected values and shares batched runs across references', async () => {
		const source = primitiveAtom(0)
		const runs = vi.fn()
		const cleanup = vi.fn()
		const effect = effectAtom(
			(get) => get(source),
			(next, last) => {
				runs(next, last)
				return cleanup
			},
		)
		const store = createStore()
		const unmountFirst = store.mountEffect(effect)
		const unmountSecond = store.mountEffect(effect)
		expect(runs).not.toHaveBeenCalled()
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([[0, undefined]])
		store.send(source, 1)
		store.send(source, 2)
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([
			[0, undefined],
			[2, 0],
		])
		expect(cleanup).toHaveBeenCalledOnce()
		unmountFirst()
		expect(cleanup).toHaveBeenCalledOnce()
		unmountSecond()
		expect(cleanup).toHaveBeenCalledTimes(2)
	})

	it('isolates previous selected values per store and resets them on remount', async () => {
		const source = primitiveAtom(0)
		const runs = vi.fn()
		const effect = effectAtom(
			(get) => get(source),
			(next, last) => runs(next, last),
		)
		const first = createStore()
		const second = createStore([[source, 10]])
		const unmountFirst = first.mountEffect(effect)
		const unmountSecond = second.mountEffect(effect)
		await flushMicrotask()
		first.send(source, 1)
		await flushMicrotask()
		unmountFirst()
		const unmountRemount = first.mountEffect(effect)
		await flushMicrotask()
		second.send(source, 11)
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([
			[0, undefined],
			[10, undefined],
			[1, 0],
			[1, undefined],
			[11, 10],
		])
		unmountRemount()
		unmountSecond()
	})

	it('tracks selected callbacks and preserves child and cleanup ordering', async () => {
		const source = primitiveAtom(1)
		const detail = primitiveAtom(2)
		const events: string[] = []
		const child = effectAtom(() => {
			events.push('child')
			return () => events.push('release child')
		})
		const effect = effectAtom(
			(get) => get(source),
			(next, last, get, _set, mountEffect) => {
				events.push(`${next}/${last}/${get(detail)}`)
				mountEffect(child)
				return () => events.push('cleanup')
			},
		)
		const store = createStore()
		const unmount = store.mountEffect(effect)
		await flushMicrotask()
		store.send(detail, 3)
		await flushMicrotask()
		unmount()
		expect(events).toEqual([
			'1/undefined/2',
			'child',
			'cleanup',
			'release child',
			'1/1/3',
			'child',
			'release child',
			'cleanup',
		])
	})

	it('tracks direct atoms and families and batches changes into one rerun', async () => {
		const source = primitiveAtom(1)
		const untouched = primitiveAtom(0)
		const values = atomFamily((key: string) => primitiveAtom(key.length))
		const observed = derivedAtom((get) => get(source) * 2)
		const runs = vi.fn()
		const effect = effectAtom((get) => {
			runs(get(source), get(observed), get(values, 'key'))
		})
		const store = createStore()
		const unmount = store.mountEffect(effect)
		expect(runs).not.toHaveBeenCalled()
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([[1, 2, 3]])
		store.send(untouched, 9)
		await flushMicrotask()
		expect(runs).toHaveBeenCalledOnce()
		store.send(source, 2)
		store.send(source, 3)
		store.send(values, 'key', 4)
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([
			[1, 2, 3],
			[3, 6, 4],
		])
		unmount()
	})

	it('cleans up before reversing old children and releases dropped direct reads after the body', async () => {
		const events: string[] = []
		const flag = primitiveAtom(true)
		const resource = (name: string) =>
			primitiveAtom(1, {
				onMount: () => {
					events.push(`mount ${name}`)
					return () => events.push(`unmount ${name}`)
				},
			})
		const first = resource('first')
		const second = resource('second')
		const child = (name: string) =>
			effectAtom(() => {
				events.push(`child ${name}`)
				return () => events.push(`release ${name}`)
			})
		const a = child('a')
		const b = child('b')
		const effect = effectAtom(
			(get) => get(get(flag) ? first : second),
			(_next, _last, _get, _set, mountEffect) => {
				events.push('body')
				mountEffect(a)
				mountEffect(b)
				return () => events.push('cleanup')
			},
		)
		const store = createStore()
		const unmount = store.mountEffect(effect)
		await flushMicrotask()
		expect(events).toEqual(['mount first', 'body', 'child a', 'child b'])
		events.length = 0
		store.send(flag, false)
		await flushMicrotask()
		expect(events).toEqual([
			'cleanup',
			'release b',
			'release a',
			'mount second',
			'body',
			'unmount first',
			'child a',
			'child b',
		])
		events.length = 0
		unmount()
		expect(events).toEqual([
			'release b',
			'release a',
			'cleanup',
			'unmount second',
		])
	})

	it('releases onMount children in reverse order before the owner cleanup', async () => {
		const events: string[] = []
		const child = (name: string) =>
			effectAtom(() => {
				events.push(name)
				return () => events.push(`~${name}`)
			})
		const owner = primitiveAtom(0, {
			onMount: (_get, _set, mountEffect) => {
				mountEffect(child('a'))
				mountEffect(child('b'))
				return () => events.push('owner cleanup')
			},
		})
		const store = createStore()
		const unsubscribe = store.subscribe(owner, () => {})
		await flushMicrotask()
		expect(events).toEqual(['a', 'b'])
		unsubscribe()
		expect(events).toEqual(['a', 'b', '~b', '~a', 'owner cleanup'])
	})

	it('shares one instance across independent idempotent external and owner references', async () => {
		const count = primitiveAtom(0)
		const cleanup = vi.fn()
		const body = vi.fn((get: Read) => {
			get(count)
			return cleanup
		})
		const effect = effectAtom(body)
		const owner = primitiveAtom(0, {
			onMount: (_get, _set, mountEffect) => {
				mountEffect(effect)
				mountEffect(effect)
			},
		})
		const store = createStore()
		const unmountFirst = store.mountEffect(effect)
		await flushMicrotask()
		expect(body).toHaveBeenCalledOnce()
		expect(body).toHaveBeenCalledWith(expect.any(Function))
		const unmountSecond = store.mountEffect(effect)
		const unsubscribeSubscription = store.subscribe(owner, () => {})
		await flushMicrotask()
		expect(body).toHaveBeenCalledOnce()
		store.send(count, 1)
		await flushMicrotask()
		expect(body).toHaveBeenCalledTimes(2)
		expect(cleanup).toHaveBeenCalledOnce()
		unmountFirst()
		unmountFirst()
		unmountSecond()
		unmountSecond()
		expect(cleanup).toHaveBeenCalledOnce()
		unsubscribeSubscription()
		unsubscribeSubscription()
		expect(cleanup).toHaveBeenCalledTimes(2)
	})

	it.each(['onMount', 'effect'] as const)(
		'rejects mountEffect after %s returns and from cleanup',
		async (kind) => {
			let captured: MountEffect = () => {}
			const child = effectAtom(() => {})
			const body = (_get: Read, _set: unknown, mountEffect: MountEffect) => {
				captured = mountEffect
				return () => expect(() => mountEffect(child)).toThrow('synchronously')
			}
			const store = createStore()
			const dispose =
				kind === 'effect'
					? store.mountEffect(
							effectAtom(
								() => undefined,
								(_next, _last, get, set, mountEffect) =>
									body(get, set, mountEffect),
							),
						)
					: store.subscribe(primitiveAtom(0, { onMount: body }), () => {})
			await flushMicrotask()
			expect(() => captured(child)).toThrow('synchronously')
			dispose()
		},
	)

	it('rejects a cycle closed by a nested mount', () => {
		const { store, flush } = manualStore()
		const first: EffectAtom = effectAtom(
			() => undefined,
			(_next, _last, _get, _set, mountEffect) => mountEffect(second),
		)
		const second = effectAtom(
			() => undefined,
			(_next, _last, _get, _set, mountEffect) => mountEffect(first),
		)
		store.mountEffect(first)
		expect(flush).toThrow('cyclic effect ownership')
	})

	it('rejects a mount cycle through an effect read and onMount', () => {
		const { store, flush } = manualStore()
		const first: EffectAtom = effectAtom(
			() => undefined,
			(_next, _last, _get, _set, mountEffect) => mountEffect(second),
		)
		const second = effectAtom((get) => {
			get(resource)
		})
		const resource = primitiveAtom(0, {
			onMount: (_get, _set, mountEffect) => mountEffect(first),
		})
		store.mountEffect(first)
		expect(flush).toThrow('cyclic effect ownership')
	})

	it.each([false, true])(
		'rejects an ownership cycle closed by a tracked read (indirect: %s)',
		(indirect) => {
			const { store, flush } = manualStore()
			const owner = primitiveAtom(0, {
				onMount: (_get, _set, mountEffect) => mountEffect(effect),
			})
			const bridge = derivedAtom((get) => get(owner))
			const effect = effectAtom((get) => {
				if (indirect) get(bridge)
				else get(owner)
			})
			store.subscribe(owner, () => {})
			expect(flush).toThrow('cyclic effect ownership')
		},
	)

	it('releases a resource dropped below an unchanged direct dependency', async () => {
		const events: string[] = []
		const flag = primitiveAtom(true)
		const resource = primitiveAtom(0, {
			onMount: () => {
				events.push('resource')
				return () => events.push('resource cleanup')
			},
		})
		const middle = derivedAtom((get) => (get(flag) ? get(resource) * 0 : 0))
		const body = vi.fn((get: Read) => {
			get(middle)
			return () => events.push('effect cleanup')
		})
		const store = createStore()
		const unmount = store.mountEffect(effectAtom(body))
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()
		expect(body).toHaveBeenCalledOnce()
		expect(events).toEqual(['resource', 'resource cleanup'])
		unmount()
		expect(events).toEqual(['resource', 'resource cleanup', 'effect cleanup'])
	})

	it('releases a resource relinked below the formerly retained orphan', async () => {
		const events: string[] = []
		const gate = primitiveAtom(true)
		const sel = primitiveAtom(false)
		const resource = primitiveAtom(0, {
			onMount: () => {
				events.push('resource')
				return () => events.push('resource cleanup')
			},
		})
		const middle = derivedAtom((get) => (get(sel) ? get(resource) * 0 : 0))
		const top = derivedAtom((get) => (get(gate) ? get(middle) : 0))
		const body = vi.fn((get: Read) => {
			get(top)
			return () => events.push('effect cleanup')
		})
		const store = createStore()
		const unmount = store.mountEffect(effectAtom(body))
		await flushMicrotask()
		store.send(gate, false)
		await flushMicrotask()
		store.send(sel, true)
		await flushMicrotask()
		store.send(gate, true)
		await flushMicrotask()
		store.send(sel, false)
		await flushMicrotask()
		expect(body).toHaveBeenCalledOnce()
		expect(events).toEqual(['resource', 'resource cleanup'])
		unmount()
		expect(events).toEqual(['resource', 'resource cleanup', 'effect cleanup'])
	})

	it.each([
		[
			'peek',
			(store: ReturnType<typeof createStore>, effect: EffectAtom) =>
				store.peek(effect as never),
		],
		[
			'send',
			(store: ReturnType<typeof createStore>, effect: EffectAtom) =>
				store.send(effect as never),
		],
		[
			'resolve',
			(store: ReturnType<typeof createStore>, effect: EffectAtom) =>
				store.resolve(effect as never),
		],
		[
			'subscribe',
			(store: ReturnType<typeof createStore>, effect: EffectAtom) =>
				store.subscribe(effect as never, () => {}),
		],
		[
			'hydrate',
			(_store: ReturnType<typeof createStore>, effect: EffectAtom) =>
				hydrate(effect as never),
		],
		[
			'raw hydration',
			(_store: ReturnType<typeof createStore>, effect: EffectAtom) =>
				createStore([[effect] as never]),
		],
		[
			'getter',
			(store: ReturnType<typeof createStore>, effect: EffectAtom) =>
				store.peek(derivedAtom((get) => get(effect as never))),
		],
	] as const)('rejects an untyped effect passed to %s', (_name, access) => {
		expect(() =>
			access(
				createStore(),
				effectAtom(() => {}),
			),
		).toThrow('effect atoms have no value')
	})

	it('rejects untyped value atoms passed to mountEffect', () => {
		const { store, flush } = manualStore()
		const value = primitiveAtom(0)
		expect(() => store.mountEffect(value as never)).toThrow(
			'requires an effect atom',
		)
		store.mountEffect(
			effectAtom(
				() => undefined,
				(_next, _last, _get, _set, mountEffect) => mountEffect(value as never),
			),
		)
		expect(flush).toThrow('requires an effect atom')
	})

	it('writes atoms, derived atoms and families in the following flush', async () => {
		const target = primitiveAtom(0)
		const doubled = derivedAtom(
			(get) => get(target) * 2,
			(_get, set, value: number) => set(target, value / 2),
		)
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom(
				() => undefined,
				(_next, _last, _get, set) => {
					set(target, 1)
					set(doubled, 6)
					set(values, 'key', (value) => value + 1)
				},
			),
		)
		await flushMicrotask()
		expect(store.peek(target)).toBe(0)
		await flushMicrotask()
		expect(store.peek(doubled)).toBe(6)
		expect(store.peek(values, 'key')).toBe(1)
		unmount()
	})

	it('keeps undefined reads real and resets dependency tracking after remount', async () => {
		const count = primitiveAtom<number | undefined>(undefined)
		const runs = vi.fn()
		const cleanup = vi.fn()
		const effect = effectAtom((get) => {
			runs(get(count))
			return cleanup
		})
		const store = createStore()
		const unmount = store.mountEffect(effect)
		await flushMicrotask()
		store.send(count, 1)
		await flushMicrotask()
		store.send(count, undefined)
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([[undefined], [1], [undefined]])
		unmount()
		unmount()
		expect(cleanup).toHaveBeenCalledTimes(3)
		const unmountAgain = store.mountEffect(effect)
		await flushMicrotask()
		expect(runs).toHaveBeenCalledTimes(4)
		unmountAgain()
		expect(cleanup).toHaveBeenCalledTimes(4)
	})

	it('disposes a setup released during its own body', async () => {
		let unmount = () => {}
		const cleanup = vi.fn()
		const store = createStore()
		unmount = store.mountEffect(
			effectAtom(() => {
				unmount()
				return cleanup
			}),
		)
		await flushMicrotask()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	it('does not repeat a cleanup that releases its effect during rerun', async () => {
		const source = primitiveAtom(0)
		const body = vi.fn()
		const cleanup = vi.fn(() => unmount())
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom((get) => {
				get(source)
				body()
				return cleanup
			}),
		)
		await flushMicrotask()
		store.send(source, 1)
		await flushMicrotask()
		expect(body).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	it('retains the new run cleanup when the old body releases and remounts itself', async () => {
		const store = createStore()
		const cleanups: ReturnType<typeof vi.fn>[] = []
		let unmount = () => {}
		let reenter = true
		const effect: EffectAtom = effectAtom(() => {
			if (reenter) {
				reenter = false
				unmount()
				unmount = store.mountEffect(effect)
			}
			const cleanup = vi.fn()
			cleanups.push(cleanup)
			return cleanup
		})
		unmount = store.mountEffect(effect)
		await flushMicrotask()
		expect(cleanups).toHaveLength(2)
		expect(cleanups[0]).toHaveBeenCalledOnce()
		expect(cleanups[1]).not.toHaveBeenCalled()
		unmount()
		expect(cleanups[1]).toHaveBeenCalledOnce()
	})
	it('settles mount writes before the first tracked read returns', async () => {
		const events: string[] = []
		const source = primitiveAtom(0, {
			onMount: (_get, set) => {
				events.push('source mount')
				set(source, 2)
				return () => events.push('source unmount')
			},
		})
		const consumer = derivedAtom((get) => get(source) * 2, undefined, {
			onMount: (get) => {
				events.push(`consumer mount:${get(source)}`)
				return () => events.push('consumer unmount')
			},
		})
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom((get) => {
				events.push(`effect:${get(consumer)}`)
				return () => events.push('effect cleanup')
			}),
		)
		await flushMicrotask()
		expect(events).toEqual(['source mount', 'consumer mount:2', 'effect:4'])
		unmount()
		expect(events).toEqual([
			'source mount',
			'consumer mount:2',
			'effect:4',
			'effect cleanup',
			'consumer unmount',
			'source unmount',
		])
	})

	it('settles a diamond once per batch before its observing effect', async () => {
		const source = primitiveAtom(0)
		const left = derivedAtom((get) => get(source) + 1)
		const right = derivedAtom((get) => get(source) + 2)
		const leaf = derivedAtom((get) => get(left) + get(right))
		const runs = vi.fn()
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom((get) => {
				runs(get(leaf), get(source))
			}),
		)
		await flushMicrotask()
		store.send(source, 1)
		store.send(source, 2)
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([
			[3, 0],
			[7, 2],
		])
		unmount()
	})
})
