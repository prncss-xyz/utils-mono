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
			(read) => read(source),
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
			(read) => read(source),
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

	it('uses the mounted child store for direct calls to factory effect bodies', async () => {
		const source = primitiveAtom(1)
		const runs = vi.fn()
		const effect = effectAtom(
			(read) => read(source),
			(next, _last, read) => runs(next, read(source)),
		)
		const first = createStore([[source, 2]])
		const second = createStore([[source, 3]])
		let unmount = () => {}
		effect.body(first.peek, first.send, (child) => {
			unmount = second.mountEffect(child)
		})
		await flushMicrotask()
		expect(runs.mock.calls).toEqual([[3, 3]])
		unmount()
	})

	it('uses the supplied child reader for direct calls without a store', () => {
		const source = primitiveAtom(1)
		const runs = vi.fn()
		const effect = effectAtom(
			(read) => read(source),
			(next, _last, read) => runs(next, read(source)),
		)
		const outer = createStore([[source, 2]])
		const inner = createStore([[source, 3]])
		effect.body(outer.peek, outer.send, (child) => {
			child.body(inner.peek, inner.send, () => {})
		})
		expect(runs.mock.calls).toEqual([[3, 3]])
	})

	it('invokes a replaced effect body with its receiver and three operations', async () => {
		const original = vi.fn()
		const replacement = vi.fn(function (
			this: EffectAtom,
			...args: Parameters<EffectAtom['body']>
		) {
			expect(this).toBe(effect)
			expect(args).toHaveLength(3)
		})
		const effect = effectAtom(() => 1, original)
		effect.body = replacement
		const store = createStore()
		const unmount = store.mountEffect(effect)
		await flushMicrotask()
		expect(replacement).toHaveBeenCalledOnce()
		expect(original).not.toHaveBeenCalled()
		unmount()
	})

	it.each([false, true])(
		'tracks only the tracker with a copied effect: %s',
		async (copied) => {
			const source = primitiveAtom(1)
			const events: string[] = []
			const detail = primitiveAtom(2, {
				onMount: () => {
					events.push('mount detail')
					return () => events.push('release detail')
				},
			})
			let deferredRead: () => number = () => 0
			const child = effectAtom(() => {
				events.push('child')
				return () => events.push('release child')
			})
			const effect = effectAtom(
				(read) => read(source),
				(next, last, read, _write, mountEffect) => {
					events.push(`${next}/${last}/${read(detail)}`)
					deferredRead = () => read(detail)
					mountEffect(child)
					return () => events.push('cleanup')
				},
			)
			const store = createStore()
			const unmount = store.mountEffect(copied ? { ...effect } : effect)
			await flushMicrotask()
			store.send(detail, 3)
			await flushMicrotask()
			expect(deferredRead()).toBe(3)
			expect(events).toEqual(['1/undefined/2', 'child'])
			store.send(detail, 4)
			await flushMicrotask()
			expect(events).toEqual(['1/undefined/2', 'child'])
			store.send(source, 2)
			await flushMicrotask()
			unmount()
			expect(events).toEqual([
				'1/undefined/2',
				'child',
				'cleanup',
				'release child',
				'2/1/4',
				'child',
				'release child',
				'cleanup',
			])
		},
	)

	it('tracks direct atoms and families and batches changes into one rerun', async () => {
		const source = primitiveAtom(1)
		const untouched = primitiveAtom(0)
		const values = atomFamily((key: string) => primitiveAtom(key.length))
		const observed = derivedAtom((read) => read(source) * 2)
		const runs = vi.fn()
		const effect = effectAtom((read) => {
			runs(read(source), read(observed), read(values, 'key'))
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

	it('cleans up before reversing old children and releases dropped direct reads after the body and its children', async () => {
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
			(read) => read(read(flag) ? first : second),
			(_next, _last, _read, _write, mountEffect) => {
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
			'child a',
			'child b',
			'unmount first',
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
		const firstChild = child('a')
		const owner = primitiveAtom(0, {
			onMount: (_read, _write, mountEffect) => {
				mountEffect(firstChild)
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
		events.length = 0
		const unmountChild = store.mountEffect(firstChild)
		await flushMicrotask()
		expect(events).toEqual(['a'])
		unmountChild()
		expect(events).toEqual(['a', '~a'])
	})

	it('shares one instance across independent idempotent external and owner references', async () => {
		const count = primitiveAtom(0)
		const cleanup = vi.fn()
		const body = vi.fn((read: Read) => {
			read(count)
			return cleanup
		})
		const effect = effectAtom(body)
		const owner = primitiveAtom(0, {
			onMount: (_read, _write, mountEffect) => {
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
			const body = (_read: Read, _write: unknown, mountEffect: MountEffect) => {
				captured = mountEffect
				return () => expect(() => mountEffect(child)).toThrow('synchronously')
			}
			const store = createStore()
			const dispose =
				kind === 'effect'
					? store.mountEffect(
							effectAtom(
								() => undefined,
								(_next, _last, read, write, mountEffect) =>
									body(read, write, mountEffect),
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
			(_next, _last, _read, _write, mountEffect) => mountEffect(second),
		)
		const second = effectAtom(
			() => undefined,
			(_next, _last, _read, _write, mountEffect) => mountEffect(first),
		)
		store.mountEffect(first)
		expect(flush).toThrow('cyclic effect ownership')
	})

	it('rejects a mount cycle through an effect read and onMount', () => {
		const { store, flush } = manualStore()
		const first: EffectAtom = effectAtom(
			() => undefined,
			(_next, _last, _read, _write, mountEffect) => mountEffect(second),
		)
		const second = effectAtom((read) => {
			read(resource)
		})
		const resource = primitiveAtom(0, {
			onMount: (_read, _write, mountEffect) => mountEffect(first),
		})
		store.mountEffect(first)
		expect(flush).toThrow('cyclic effect ownership')
	})

	it.each([false, true])(
		'rejects an ownership cycle closed by a tracked read (indirect: %s)',
		(indirect) => {
			const { store, flush } = manualStore()
			const owner = primitiveAtom(0, {
				onMount: (_read, _write, mountEffect) => mountEffect(effect),
			})
			const bridge = derivedAtom((read) => read(owner))
			const effect = effectAtom((read) => {
				if (indirect) read(bridge)
				else read(owner)
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
		const middle = derivedAtom((read) => (read(flag) ? read(resource) * 0 : 0))
		const body = vi.fn((read: Read) => {
			read(middle)
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
		const middle = derivedAtom((read) => (read(sel) ? read(resource) * 0 : 0))
		const top = derivedAtom((read) => (read(gate) ? read(middle) : 0))
		const body = vi.fn((read: Read) => {
			read(top)
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
				store.peek(derivedAtom((read) => read(effect as never))),
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
				(_next, _last, _read, _write, mountEffect) =>
					mountEffect(value as never),
			),
		)
		expect(flush).toThrow('requires an effect atom')
	})

	it('writes atoms, derived atoms and families in the following flush', async () => {
		const target = primitiveAtom(0)
		const doubled = derivedAtom(
			(read) => read(target) * 2,
			(_read, write, value: number) => write(target, value / 2),
		)
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom(
				() => undefined,
				(_next, _last, _read, write) => {
					write(target, 1)
					write(doubled, 6)
					write(values, 'key', (value) => value + 1)
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
		const effect = effectAtom((read) => {
			runs(read(count))
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
			effectAtom((read) => {
				read(source)
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
			onMount: (_read, write) => {
				events.push('source mount')
				write(source, 2)
				return () => events.push('source unmount')
			},
		})
		const consumer = derivedAtom((read) => read(source) * 2, undefined, {
			onMount: (read) => {
				events.push(`consumer mount:${read(source)}`)
				return () => events.push('consumer unmount')
			},
		})
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom((read) => {
				events.push(`effect:${read(consumer)}`)
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
		const left = derivedAtom((read) => read(source) + 1)
		const right = derivedAtom((read) => read(source) + 2)
		const leaf = derivedAtom((read) => read(left) + read(right))
		const runs = vi.fn()
		const store = createStore()
		const unmount = store.mountEffect(
			effectAtom((read) => {
				runs(read(leaf), read(source))
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
