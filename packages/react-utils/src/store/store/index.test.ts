import { assert, describe, expect, it, type Mock, vi } from 'vitest'

import {
	derivedAtom,
	atomFamily,
	hydrate,
	primitiveAtom,
	TRANSIENT,
	type AtomSymbol,
	type Read,
	type Store,
} from '.'
import { isoAssert, type SetStateWithReset } from '../../functions'
import { createCommands } from '../commandAtoms'
import {
	consumerCount,
	countOperations,
	createStore,
	flushMicrotask,
	inspect,
} from './utils.testing'

const internalInstance = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => {
	const instance = inspect(store).instances.get(symbol as AtomSymbol<any, any>)
	isoAssert(instance)
	return instance
}

const mountedSubCount = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => consumerCount(internalInstance(store, symbol))

const mountCount = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
) => internalInstance(store, symbol).mountCount

const expectNoStrongReferences = <S, Args extends unknown[]>(
	store: Store,
	symbol: AtomSymbol<S, Args>,
	dependants: Set<object>,
) => {
	const source: object = internalInstance(store, symbol)
	const holds = (value: unknown) => dependants.has(value as object)
	for (const value of Object.values(source)) {
		expect(holds(value)).toBe(false)
		if (value instanceof Set || Array.isArray(value)) {
			for (const item of value) expect(holds(item)).toBe(false)
		} else if (value instanceof Map) {
			for (const [entryKey, entryValue] of value) {
				expect(holds(entryKey)).toBe(false)
				expect(holds(entryValue)).toBe(false)
			}
		}
	}
}

describe('Store', () => {
	it('hydrates atoms and family members before the store is returned', () => {
		const count = primitiveAtom(0)
		const str = primitiveAtom('')
		const doubled = derivedAtom(
			(read) => read(count) * 2,
			(_read, write, value: number) => write(count, value / 2),
		)
		const members = atomFamily((key: string) => primitiveAtom(key.length), {
			TTL: Infinity,
		})
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const create = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: number) =>
				write(values, 'a', value),
			),
		)
		const commands = atomFamily(create)
		const store = createStore([
			[count, 4],
			[doubled, 12],
			[str, 'a'],
			hydrate(members, 'first', 10),
			[values, 'b', 5],
			[commands, 'a', 7],
		])

		expect(store.peek(count)).toBe(6)
		expect(store.peek(doubled)).toBe(12)
		expect(store.peek(str)).toBe('a')
		expect(store.peek(members, 'first')).toBe(10)
		expect(store.peek(members, 'other')).toBe(5)
		expect(store.peek(values, 'a')).toBe(7)
		expect(store.peek(values, 'b')).toBe(5)
		store.resolve(commands, 'a')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('isolates resolved handles and state per store', async () => {
		const atom = primitiveAtom(0)
		const first = createStore()
		const second = createStore()

		expect(first.resolve(atom)).toBe(first.resolve(atom))
		expect(second.resolve(atom)).not.toBe(first.resolve(atom))

		first.resolve(atom).send(5)
		await flushMicrotask()
		expect(first.resolve(atom).peek()).toBe(5)
		expect(second.resolve(atom).peek()).toBe(0)
		expect(second.peek(atom)).toBe(0)
	})

	it('settles a diamond once per batch', async () => {
		const events: string[] = []
		const effect =
			(name: string) =>
			(next: number | undefined, last: number | undefined) => {
				events.push(`run:${name}:${last}->${next}`)
				return () => {
					events.push(`cleanup:${name}:${next}`)
				}
			}
		const source = primitiveAtom(0, { effect: effect('source') })
		const other = primitiveAtom(0)
		const left = derivedAtom<number>((read) => read(source) + 1, undefined, {
			effect: effect('left'),
		})
		const right = derivedAtom<number>((read) => read(source) + 2, undefined, {
			effect: effect('right'),
		})
		const leaf = derivedAtom<number>(
			(read) => read(left) + read(right),
			undefined,
			{ effect: effect('leaf') },
		)
		const sum = derivedAtom((read) => read(source) + read(other))
		const store = createStore()
		const leafSeen: number[] = []
		const sumSeen: number[] = []
		store.subscribe(leaf, () => leafSeen.push(store.peek(leaf)))
		store.subscribe(sum, () => sumSeen.push(store.peek(sum)))
		await flushMicrotask()
		events.length = 0

		store.send(source, 1)
		store.send(source, 2)
		store.send(other, 5)
		await flushMicrotask()

		expect(leafSeen).toEqual([7])
		expect(sumSeen).toEqual([7])
		expect(events).toEqual([
			'cleanup:leaf:3',
			'cleanup:right:2',
			'cleanup:left:1',
			'cleanup:source:0',
			'run:source:0->2',
			'run:left:1->3',
			'run:right:2->4',
			'run:leaf:3->7',
		])
	})

	it('reads and writes atom families from a derived setter', async () => {
		const sourceFamily = atomFamily((_key: string) => primitiveAtom(3))
		const targetFamily = atomFamily((_key: string) => primitiveAtom(0))
		const selected = derivedAtom(
			(read) => read(targetFamily, 'target'),
			(read, write, multiplier: number) =>
				write(
					targetFamily,
					'target',
					read(sourceFamily, 'source') * multiplier,
				),
		)
		const store = createStore()

		store.send(selected, 2)
		await flushMicrotask()

		expect(store.peek(targetFamily, 'target')).toBe(6)
	})

	it('tracks dependencies on the resolved family member', async () => {
		const numbers = atomFamily((key: string) =>
			primitiveAtom(key === 'first' ? 1 : 10),
		)
		const selected = derivedAtom(
			(read) => read(numbers, 'first'),
			(_read, _write, _event: never) => {},
		)
		const store = createStore()
		const subscriber = vi.fn()

		store.subscribe(selected, subscriber)
		expect(store.peek(selected)).toBe(1)

		store.send(numbers, 'second', 11)
		await flushMicrotask()
		expect(subscriber).not.toHaveBeenCalled()
		expect(store.peek(selected)).toBe(1)

		store.send(numbers, 'first', 2)
		await flushMicrotask()
		expect(subscriber).toHaveBeenCalledOnce()
		expect(store.peek(selected)).toBe(2)
	})

	it('replaces conditional dependencies without notifying from stale sources', async () => {
		const selectFirst = primitiveAtom(true)
		const first = primitiveAtom(1)
		const second = primitiveAtom(10)
		const selected = derivedAtom(
			(read) => (read(selectFirst) ? read(first) : read(second)),
			() => {},
		)
		const store = createStore()
		const subscriber = vi.fn(() => store.peek(selected))
		store.subscribe(selected, subscriber)
		expect(store.peek(selected)).toBe(1)

		store.send(selectFirst, false)
		await flushMicrotask()
		expect(subscriber).toHaveLastReturnedWith(10)
		subscriber.mockClear()

		store.send(first, 2)
		await flushMicrotask()
		expect(subscriber).not.toHaveBeenCalled()

		store.send(second, 11)
		await flushMicrotask()
		expect(subscriber).toHaveBeenCalledOnce()
		expect(subscriber).toHaveLastReturnedWith(11)
	})

	it('reads atoms and families in effects without tracking dependencies', async () => {
		const source = primitiveAtom(1)
		const values = atomFamily((key: string) => primitiveAtom(key.length))
		const observed = derivedAtom(
			(read) => read(source) * 2,
			() => {},
		)
		const runs = vi.fn()
		const trigger = primitiveAtom(0, {
			effect: (next, _last, get) => {
				runs(next, get(source), get(observed), get(values, 'key'))
			},
		})
		const store = createStore()

		store.subscribe(trigger, () => {})
		await flushMicrotask()
		expect(runs).toHaveBeenLastCalledWith(0, 1, 2, 3)

		store.send(source, 2)
		store.send(values, 'key', 4)
		await flushMicrotask()
		expect(runs).toHaveBeenCalledOnce()

		store.send(trigger, 1)
		await flushMicrotask()
		expect(runs).toHaveBeenLastCalledWith(1, 2, 4, 4)
	})

	it('writes other atoms, derived atoms, and families from effects', async () => {
		const target = primitiveAtom(0)
		const doubled = derivedAtom(
			(read) => read(target) * 2,
			(_read, write, value: number) => write(target, value / 2),
		)
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const trigger = primitiveAtom(0, {
			effect: (next, _last, _get, set) => {
				if (next === undefined) return
				set(target, 1)
				set(doubled, 6)
				set(values, 'key', (value) => value + 1)
			},
		})
		const store = createStore()

		store.subscribe(trigger, () => {})
		await flushMicrotask()
		expect(store.peek(target)).toBe(0)
		expect(store.peek(values, 'key')).toBe(0)
		await flushMicrotask()
		expect(store.peek(doubled)).toBe(6)
		expect(store.peek(values, 'key')).toBe(1)
	})

	it.each(['primitive', 'derived'] as const)(
		'treats undefined as a real %s value and only cleans up on unmount',
		async (kind) => {
			const cleanup = vi.fn()
			const effect = vi.fn(() => cleanup)
			const source = primitiveAtom<number | undefined>(
				undefined,
				kind === 'primitive' ? { effect } : undefined,
			)
			const atom =
				kind === 'primitive'
					? source
					: derivedAtom(
							(get) => get(source),
							(_get, set, value: SetStateWithReset<number | undefined>) =>
								set(source, value),
							{ effect },
						)
			const store = createStore()
			const release = store.subscribe(atom, vi.fn())
			await flushMicrotask()
			expect(effect).toHaveBeenCalledOnce()
			expect(effect.mock.calls[0]).toEqual([
				undefined,
				undefined,
				expect.any(Function),
				expect.any(Function),
			])
			store.send(atom, 1)
			await flushMicrotask()
			store.send(atom, undefined)
			await flushMicrotask()
			expect(effect).toHaveBeenCalledTimes(3)
			expect(effect.mock.calls[2]).toEqual([
				undefined,
				1,
				expect.any(Function),
				expect.any(Function),
			])
			release()
			release()
			expect(effect).toHaveBeenCalledTimes(3)
			expect(cleanup).toHaveBeenCalledTimes(3)
			const releaseAgain = store.subscribe(atom, vi.fn())
			await flushMicrotask()
			expect(effect).toHaveBeenCalledTimes(4)
			expect(effect.mock.calls[3]).toEqual([
				undefined,
				undefined,
				expect.any(Function),
				expect.any(Function),
			])
			releaseAgain()
			expect(cleanup).toHaveBeenCalledTimes(4)
		},
	)

	it.each(['source', 'consumer'] as const)(
		'disposes the cleanup of an effect whose setup releases the %s',
		async (target) => {
			let release = () => {}
			const cleanup = vi.fn()
			const effect = vi.fn(() => {
				release()
				return cleanup
			})
			const source = primitiveAtom(0, { effect })
			const consumer = derivedAtom<number>((read) => read(source))
			const store = createStore()
			release =
				target === 'consumer'
					? store.subscribe(consumer, () => {})
					: store.subscribe(source, () => {})
			await flushMicrotask()
			expect(effect).toHaveBeenCalledOnce()
			expect(cleanup).toHaveBeenCalledOnce()
		},
	)

	it('disposes an old run and keeps the newer run cleanup when setup releases and remounts', async () => {
		const store = createStore()
		const cleanups: Mock<() => void>[] = []
		let release = () => {}
		let reenter = true
		const atom = primitiveAtom(0, {
			effect: () => {
				if (reenter) {
					reenter = false
					release()
					release = store.subscribe(atom, () => {})
				}
				const cleanup = vi.fn()
				cleanups.push(cleanup)
				return cleanup
			},
		})
		release = store.subscribe(atom, () => {})
		await flushMicrotask()
		expect(cleanups).toHaveLength(1)
		expect(cleanups[0]).toHaveBeenCalledOnce()
		await flushMicrotask()
		expect(cleanups).toHaveLength(2)
		expect(cleanups[0]).toHaveBeenCalledOnce()
		expect(cleanups[1]).not.toHaveBeenCalled()
		release()
		expect(cleanups[0]).toHaveBeenCalledOnce()
		expect(cleanups[1]).toHaveBeenCalledOnce()
	})

	it('does not repeat cleanup or rerun effects when cleanup unsubscribes the consumer', async () => {
		const events: string[] = []
		let unsubscribe = () => {}
		const source = primitiveAtom(0, {
			effect: (next) => {
				events.push(`run:source:${next}`)
				return () => {
					events.push(`cleanup:source:${next}`)
				}
			},
		})
		const consumer = derivedAtom<number>((read) => read(source), undefined, {
			effect: (next) => {
				events.push(`run:consumer:${next}`)
				return () => {
					events.push(`cleanup:consumer:${next}`)
					unsubscribe()
				}
			},
		})
		const store = createStore()
		unsubscribe = store.subscribe(consumer, () => {})
		await flushMicrotask()
		events.length = 0
		store.send(source, 1)
		await flushMicrotask()
		expect(events).toEqual(['cleanup:consumer:0', 'cleanup:source:0'])
	})

	const remounting = (hooks: {
		source?: (next: number, remount: () => void) => void
		cleanup?: (remount: () => void) => void
	}) => {
		const events: string[] = []
		const store = createStore()
		let unsubscribe = () => {}
		let remounted = false
		const remount = () => {
			if (remounted) return
			remounted = true
			unsubscribe()
			unsubscribe = store.subscribe(consumer, () => {})
		}
		const source = primitiveAtom(0, {
			effect: (next) => hooks.source?.(next, remount),
		})
		const consumer = derivedAtom((read) => read(source), undefined, {
			onMount: () => {
				events.push('mount')
				return () => events.push('unmount')
			},
			effect: (next, last) => {
				events.push(`setup:${last}->${next}`)
				return () => {
					events.push(`cleanup:${next}`)
					hooks.cleanup?.(remount)
				}
			},
		})
		const unsubscribeSource = store.subscribe(source, () => {})
		unsubscribe = store.subscribe(consumer, () => {})
		return {
			events,
			store,
			source,
			release: () => {
				unsubscribe()
				unsubscribeSource()
			},
		}
	}

	const updatedTwice = [
		'mount',
		'setup:undefined->0',
		'cleanup:0',
		'unmount',
		'mount',
		'setup:undefined->1',
		'cleanup:1',
		'unmount',
	]

	it('defers initial setup if a dependency effect remounts its consumer', async () => {
		const { events, release } = remounting({
			source: (_next, remount) => remount(),
		})
		await flushMicrotask()
		await flushMicrotask()
		release()

		expect(events).toEqual([
			'mount',
			'unmount',
			'mount',
			'setup:undefined->0',
			'cleanup:0',
			'unmount',
		])
	})

	it('waits for a remounted consumer before setup when its cleanup remounts it', async () => {
		const { events, store, source, release } = remounting({
			cleanup: (remount) => remount(),
		})
		await flushMicrotask()
		store.send(source, 1)
		await flushMicrotask()
		await flushMicrotask()
		release()

		expect(events).toEqual(updatedTwice)
	})

	it('waits for a remounted consumer before setup when a dependency setup remounts it', async () => {
		const { events, store, source, release } = remounting({
			source: (next, remount) => {
				if (next === 1) remount()
			},
		})
		await flushMicrotask()
		store.send(source, 1)
		await flushMicrotask()
		await flushMicrotask()
		release()

		expect(events).toEqual(updatedTwice)
	})

	it('keeps dependency ownership balanced when cleanup remounts a consumer', async () => {
		const cleanup = vi.fn()
		const sourceEffect = vi.fn(() => cleanup)
		const source = primitiveAtom(1, { effect: sourceEffect })
		let remount = () => {}
		const consumer = derivedAtom<number>((read) => read(source), undefined, {
			effect: () => () => remount(),
		})
		const store = createStore()
		const unsubscribe = store.subscribe(consumer, () => {})
		let unsubscribeAgain = () => {}
		const notifyAgain = vi.fn()
		remount = () => {
			remount = () => {}
			unsubscribeAgain = store.subscribe(consumer, notifyAgain)
		}
		await flushMicrotask()
		unsubscribe()
		await flushMicrotask()
		expect(sourceEffect).toHaveBeenCalledOnce()
		store.send(source, 7)
		await flushMicrotask()
		expect(notifyAgain).toHaveBeenCalledOnce()
		expect(store.peek(consumer)).toBe(7)
		expect(sourceEffect).toHaveBeenCalledTimes(2)
		expect(cleanup).toHaveBeenCalledOnce()
		unsubscribeAgain()
		expect(sourceEffect).toHaveBeenCalledTimes(2)
		expect(cleanup).toHaveBeenCalledTimes(2)
	})

	describe('conditional dependency cleanup ordering', () => {
		const setup = (equal = false) => {
			const events: string[] = []
			const resource = (name: string, value: number) =>
				primitiveAtom(value, {
					effect: () => {
						events.push(`${name} setup`)
						return () => events.push(`${name} cleanup`)
					},
				})
			const first = resource('first', 1)
			const second = resource('second', equal ? 1 : 2)
			const chooseFirst = primitiveAtom(true)
			const store = createStore()
			const consumer = derivedAtom<number>(
				(read) => read(read(chooseFirst) ? first : second),
				undefined,
				{
					effect: (value) => {
						events.push(`consumer ${value} setup`)
						return () => events.push(`consumer ${value} cleanup`)
					},
				},
			)
			return { events, first, second, chooseFirst, store, consumer }
		}

		const reversedPair = ({
			onACleanup,
		}: {
			onACleanup?: (pair: {
				store: Store
				b: AtomSymbol<number, never>
			}) => void
		} = {}) => {
			const events: string[] = []
			const choice = primitiveAtom(true)
			let resourceLive = false
			let consumerSawLiveResource = false
			const b: AtomSymbol<number, never> = derivedAtom<number>(
				(read): number => (read(choice) ? 1 : read(a)),
				undefined,
				{
					effect: () => {
						events.push('B setup')
						resourceLive = true
						return () => {
							events.push('B cleanup')
							resourceLive = false
						}
					},
				},
			)
			const a: AtomSymbol<number, never> = derivedAtom<number>(
				(read): number => (read(choice) ? read(b) : 1),
				undefined,
				{
					effect: () => {
						events.push('A setup')
						return () => {
							events.push('A cleanup')
							consumerSawLiveResource = resourceLive
							onACleanup?.({ store, b })
						}
					},
				},
			)
			const store = createStore()
			const releases = {
				B: store.subscribe(b, () => {}),
				A: store.subscribe(a, () => {}),
			}
			return {
				events,
				choice,
				a,
				b,
				store,
				releases,
				consumerSawLiveResource: () => consumerSawLiveResource,
			}
		}

		it.each([
			[['A', 'B'], [false]],
			[['B', 'A'], [false]],
			[
				['A', 'B'],
				[false, true],
			],
			[
				['B', 'A'],
				[false, true],
			],
		] as const)(
			'releases equal-valued reversed dependencies in order %s after choices %s',
			async (order, choices) => {
				const {
					events,
					choice,
					a,
					b,
					store,
					releases,
					consumerSawLiveResource,
				} = reversedPair()
				await flushMicrotask()
				events.length = 0
				for (const value of choices) {
					store.send(choice, value)
					await flushMicrotask()
				}
				expect(events).toEqual([])
				releases[order[0]]()
				expect(events).toEqual([])
				releases[order[1]]()
				expect(events).toEqual(['A cleanup', 'B cleanup'])
				expect(consumerSawLiveResource()).toBe(true)
				expect(mountCount(store, a)).toBe(0)
				expect(mountCount(store, b)).toBe(0)
			},
		)

		it.each([
			['A', 'B'],
			['B', 'A'],
		] as const)(
			'rebuilds the consumer when its cleanup remounts the dependency (%s released before %s)',
			async (first, second) => {
				let releaseAgain = () => {}
				let remounted = false
				const { events, choice, a, b, store, releases } = reversedPair({
					onACleanup: ({ store, b }) => {
						if (remounted) return
						remounted = true
						releaseAgain = store.subscribe(b, () => {})
					},
				})
				await flushMicrotask()
				events.length = 0
				store.send(choice, false)
				await flushMicrotask()
				expect(events).toEqual([])
				releases[first]()
				expect(events).toEqual([])
				releases[second]()
				expect(events).toEqual(['A cleanup'])
				await flushMicrotask()
				expect(events).toEqual(['A cleanup', 'A setup'])
				expect(mountCount(store, a)).toBe(1)
				expect(mountCount(store, b)).toBe(1)
				releaseAgain()
				expect(events).toEqual([
					'A cleanup',
					'A setup',
					'B cleanup',
					'A cleanup',
				])
				expect(mountCount(store, a)).toBe(0)
				expect(mountCount(store, b)).toBe(0)
			},
		)

		it('keeps removed resources while equal values preserve the old effect', async () => {
			const { events, chooseFirst, second, first, store, consumer } =
				setup(true)
			const release = store.subscribe(consumer, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			expect(events).toEqual(['second setup'])
			const notify = vi.fn()
			const releaseNotify = store.subscribe(consumer, notify)
			store.send(first, 3)
			await flushMicrotask()
			expect(notify).not.toHaveBeenCalled()
			events.length = 0
			store.send(second, 2)
			await flushMicrotask()
			expect(events).toEqual([
				'consumer 1 cleanup',
				'first cleanup',
				'second cleanup',
				'second setup',
				'consumer 2 setup',
			])
			releaseNotify()
			release()
		})

		it('preserves ownership when old resource cleanup remounts the consumer', async () => {
			const { events, chooseFirst, first, store, consumer } = setup()
			let releaseAgain = () => {}
			first.effect = () => () => {
				events.push('first cleanup')
				release()
				releaseAgain = store.subscribe(consumer, () => {})
			}
			const release = store.subscribe(consumer, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(chooseFirst, false)
			await flushMicrotask()
			await flushMicrotask()
			expect(events.indexOf('consumer 1 cleanup')).toBeLessThan(
				events.indexOf('first cleanup'),
			)
			expect(mountCount(store, consumer)).toBe(1)
			releaseAgain()
			expect(mountCount(store, consumer)).toBe(0)
			expect(events.filter((event) => event === 'first cleanup')).toHaveLength(
				1,
			)
			expect(events.filter((event) => event === 'second cleanup')).toHaveLength(
				1,
			)
		})
	})

	it('counts a nested subscribe made while an unmounted instance is being retained', async () => {
		const flag = primitiveAtom(true)
		const nestedSubscribe = vi.fn()
		const evaluate = vi.fn()
		const inner = primitiveAtom(5, {
			onMount: () => () => {
				store.subscribe(derived, () => {})
				nestedSubscribe()
			},
		})
		const middle = derivedAtom((read) => {
			evaluate()
			return read(flag) ? read(inner) : 0
		})
		const derived = derivedAtom((read) => {
			evaluate()
			return read(middle) + 1
		})
		const store = createStore()
		store.peek(derived)
		let subscribed = false
		store.subscribe(middle, () => {
			if (subscribed) return
			subscribed = true
			store.subscribe(derived, () => {})
		})
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()
		expect(nestedSubscribe).toHaveBeenCalledOnce()
		expect(mountCount(store, derived)).toBe(2)
		expect(evaluate).toHaveBeenCalledTimes(4)
	})

	it('settles mount writes before dependent mounts and initial effects', async () => {
		const order: string[] = []
		const source = primitiveAtom(0, {
			onMount: (_get, set) => {
				order.push('source mount')
				set(source, 2)
				return () => {
					order.push('source unmount')
				}
			},
			effect: (next) => {
				order.push(`source effect:${next}`)
				return () => {
					order.push('source effect cleanup')
				}
			},
		})
		const consumer = derivedAtom(
			(get) => get(source) * 2,
			() => {},
			{
				onMount: (get) => {
					order.push(`consumer mount:${get(source)}`)
					return () => {
						order.push('consumer unmount')
					}
				},
				effect: (next) => {
					order.push(`consumer effect:${next}`)
					return () => {
						order.push('consumer effect cleanup')
					}
				},
			},
		)
		const store = createStore()
		const release = store.subscribe(consumer, vi.fn())
		expect(order).toEqual([])
		await flushMicrotask()
		expect(order).toEqual([
			'source mount',
			'consumer mount:2',
			'source effect:2',
			'consumer effect:4',
		])
		order.length = 0
		release()
		expect(order).toEqual([
			'consumer effect cleanup',
			'consumer unmount',
			'source effect cleanup',
			'source unmount',
		])
	})

	const swappable = () => {
		const events: string[] = []
		const resource = (name: string, value: number) =>
			primitiveAtom(value, {
				onMount: () => {
					events.push(`${name} mount`)
					return () => events.push(`${name} unmount`)
				},
				effect: () => {
					events.push(`${name} setup`)
					return () => events.push(`${name} cleanup`)
				},
			})
		const first = resource('first', 1)
		const second = resource('second', 2)
		const selectFirst = primitiveAtom(true)
		const select = (read: Read) =>
			read(selectFirst) ? read(first) : read(second)
		return { events, selectFirst, select }
	}

	it('swaps resources under a consumer whose effect returns no cleanup', async () => {
		const { events, selectFirst, select } = swappable()
		const consumer = derivedAtom(select, undefined, {
			effect: (value) => {
				events.push(`consumer ${value}`)
			},
		})
		const store = createStore()
		const unsubscribe = store.subscribe(consumer, () => {})
		await flushMicrotask()
		store.send(selectFirst, false)
		await flushMicrotask()
		unsubscribe()
		expect(events).toEqual([
			'first mount',
			'first setup',
			'consumer 1',
			'first cleanup',
			'first unmount',
			'second mount',
			'second setup',
			'consumer 2',
			'second cleanup',
			'second unmount',
		])
	})

	it('keeps reconciling when a later mount write switches a mounted consumer', async () => {
		const { events, selectFirst, select } = swappable()
		const consumer = derivedAtom(select)
		const trigger = primitiveAtom(0, {
			onMount: (_get, set) => {
				set(selectFirst, false)
			},
		})
		const store = createStore()
		const unsubscribe = store.subscribe(consumer, () => {})
		await flushMicrotask()
		expect(events).toEqual(['first mount', 'first setup'])

		const unsubscribeTrigger = store.subscribe(trigger, () => {})
		await flushMicrotask()
		expect(events).toEqual([
			'first mount',
			'first setup',
			'first cleanup',
			'first unmount',
			'second mount',
			'second setup',
		])

		unsubscribeTrigger()
		unsubscribe()
		expect(events.slice(6)).toEqual(['second cleanup', 'second unmount'])
	})

	it('re-runs consumers before guarded dependencies', async () => {
		const items = primitiveAtom([{ name: 'a' }])
		const index = primitiveAtom(0)
		const valid = primitiveAtom(true)
		const releaseDetail = vi.fn()
		const detailGetter = vi.fn((read: Read) => read(items)[read(index)]?.name)
		const detail = derivedAtom(detailGetter, () => {}, {
			effect: () => releaseDetail,
		})
		const outer = derivedAtom(
			(read) => (read(valid) ? read(detail) : null),
			() => {},
		)
		const store = createStore()
		const unsubscribe = store.subscribe(outer, () => {})
		await flushMicrotask()
		expect(detailGetter).toHaveBeenCalledOnce()
		store.send(index, 3)
		store.send(valid, false)
		await flushMicrotask()
		expect(detailGetter).toHaveBeenCalledOnce()
		expect(releaseDetail).toHaveBeenCalledOnce()
		expect(store.peek(outer)).toBeNull()
		unsubscribe()
	})

	it('does not link an unmounted evicted member to its dependencies', async () => {
		const base = primitiveAtom(1)
		const getter = vi.fn((read: Read) => read(base) * 2)
		let member: AtomSymbol<number, never> | undefined
		const doubles = atomFamily((_key: string) => {
			member = derivedAtom(getter)
			return member
		})
		const store = createStore()

		store.subscribe(doubles, 'first', () => {})()
		await flushMicrotask()

		expect(mountedSubCount(store, base)).toBe(0)
		expect(getter).toHaveBeenCalledOnce()
		store.send(base, 5)
		await flushMicrotask()
		assert(member)
		expect(store.peek(member)).toBe(10)
		expect(getter).toHaveBeenCalledTimes(2)
	})

	it('evicts entries created during a flush in the following flush', async () => {
		const store = createStore()
		const ephemeralCreate = vi.fn((_key: string) => primitiveAtom(0))
		const ephemeral = atomFamily(ephemeralCreate)
		const trigger = primitiveAtom(0, {
			effect: () => {
				store.peek(ephemeral, 'a')
			},
		})
		const release = store.subscribe(trigger, () => {})
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledOnce()
		await flushMicrotask()
		store.peek(ephemeral, 'a')
		expect(ephemeralCreate).toHaveBeenCalledTimes(2)
		release()
	})

	it.each([
		['effect', (write: () => void) => ({ effect: write })],
		['onMount', (write: () => void) => ({ onMount: write })],
	] as const)(
		'keeps a released TTL-0 entry written by %s',
		async (_source, options) => {
			const create = vi.fn((key: string) => primitiveAtom(key))
			const names = atomFamily(create)
			const store = createStore()
			const release = store.subscribe(names, 'first', () => {})
			await flushMicrotask()
			release()
			const trigger = primitiveAtom(
				0,
				options(() => store.send(names, 'first', 'saved')),
			)
			const releaseTrigger = store.subscribe(trigger, () => {})
			await flushMicrotask()
			await flushMicrotask()
			expect(store.peek(names, 'first')).toBe('saved')
			expect(create).toHaveBeenCalledOnce()
			releaseTrigger()
		},
	)

	it('retains a written readable family member', async () => {
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const create = vi.fn((_key: string) =>
			derivedAtom(
				(read: Read) => read(values, 'a'),
				(_read, write, value: SetStateWithReset<number>) =>
					write(values, 'a', value),
			),
		)
		const family = atomFamily(create)
		const store = createStore()
		store.send(family, 'a', 7)
		await flushMicrotask()
		expect(store.peek(family, 'a')).toBe(7)
		expect(create).toHaveBeenCalledOnce()
	})

	it('evicts written write-only members while retaining the primitives they write', async () => {
		const values = atomFamily((_key: string) => primitiveAtom(0))
		const create = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: SetStateWithReset<number>) =>
				write(values, 'a', value),
			),
		)
		const family = atomFamily(create)
		const commands = createCommands<{ save: (value: number) => void }>()
		const createCommand = vi.fn((_key: string) =>
			derivedAtom(null, (_read, write, value: number) =>
				write(commands.cmd.save, value),
			),
		)
		const commandFamily = atomFamily(createCommand)
		const store = createStore()
		store.send(commands.dependencyAtom, {
			save: (value) => store.send(values, 'b', value),
		})
		await flushMicrotask()

		store.send(family, 'a', 7)
		store.send(commandFamily, 'a', 8)
		await flushMicrotask()

		expect(store.peek(values, 'a')).toBe(7)
		expect(store.peek(values, 'b')).toBe(8)
		store.resolve(family, 'a')
		store.resolve(commandFamily, 'a')
		expect(create).toHaveBeenCalledTimes(2)
		expect(createCommand).toHaveBeenCalledTimes(2)
	})

	const transientDerived = (
		source: AtomSymbol<number, [SetStateWithReset<number>]>,
		created: AtomSymbol<number, never>[],
	) =>
		atomFamily(
			(key: number) => {
				const symbol = derivedAtom((read) => read(source) + key)
				created.push(symbol)
				return symbol
			},
			{ TTL: TRANSIENT },
		)

	type Access = (
		store: ReturnType<typeof createStore>,
		family: ReturnType<typeof transientDerived>,
		key: number,
	) => number

	it.each<[string, Access]>([
		[
			'subscribe',
			(store, family, key) => {
				const handle = store.resolve(family, key)
				const value = handle.peek()
				handle.subscribe(() => {})()
				return value
			},
		],
		['resolve peek', (store, family, key) => store.resolve(family, key).peek()],
		['family peek', (store, family, key) => store.peek(family, key)],
	])('detaches transient dependants after %s churn', async (_name, access) => {
		const source = primitiveAtom(1)
		const created: AtomSymbol<number, never>[] = []
		const family = transientDerived(source, created)
		const store = createStore()
		for (let key = 0; key < 100; key++)
			expect(access(store, family, key)).toBe(1 + key)
		await flushMicrotask()
		const dependants = new Set<object>(
			created.map((symbol) => internalInstance(store, symbol)),
		)
		expect(dependants.size).toBe(100)
		expect(mountedSubCount(store, source)).toBe(0)
		expectNoStrongReferences(store, source, dependants)
	})

	it.each([
		['peeked', () => {}],
		[
			'subscribed and released',
			(store: Store, derived: AtomSymbol<number, never>) =>
				store.subscribe(derived, () => {})(),
		],
	] as const)(
		'does not retain discarded ordinary derivations (%s)',
		async (_name, use) => {
			const source = primitiveAtom(1)
			const store = createStore()
			const dependants = new Set<object>()
			for (let key = 0; key < 100; key++) {
				const derived = derivedAtom((read) => read(source) + key)
				expect(store.peek(derived)).toBe(1 + key)
				dependants.add(internalInstance(store, derived))
				use(store, derived)
			}
			await flushMicrotask()
			expect(dependants.size).toBe(100)
			expect(mountedSubCount(store, source)).toBe(0)
			expectNoStrongReferences(store, source, dependants)
		},
	)

	it('validates each instance of a layered diamond at most once per change', async () => {
		const leaf = primitiveAtom(1)
		const depth = 20
		const width = 2
		const evaluate = vi.fn()
		let layer: AtomSymbol<number, never>[] = [leaf as AtomSymbol<number, never>]
		for (let level = 0; level < depth; level++) {
			const previous = layer
			layer = Array.from({ length: width }, () =>
				derivedAtom((read) => {
					evaluate()
					return previous.reduce((sum, atom) => sum + read(atom), 0)
				}),
			)
		}
		const top = derivedAtom((read) =>
			layer.reduce((sum, atom) => sum + read(atom), 0),
		)
		const store = createStore()
		const { totals } = countOperations(store)
		const initial = store.peek(top)
		const derivedCount = depth * width
		expect(evaluate).toHaveBeenCalledTimes(derivedCount)
		const validations = totals.validations
		expect(store.peek(top)).toBe(initial)
		expect(store.peek(top)).toBe(initial)
		expect(totals.validations).toBe(validations)
		expect(evaluate).toHaveBeenCalledTimes(derivedCount)
		store.send(leaf, 2)
		await flushMicrotask()
		expect(store.peek(top)).toBe(2 * initial)
		expect(evaluate).toHaveBeenCalledTimes(2 * derivedCount)
		expect(totals.validations - validations).toBeLessThanOrEqual(
			derivedCount + 1,
		)
	})
})
