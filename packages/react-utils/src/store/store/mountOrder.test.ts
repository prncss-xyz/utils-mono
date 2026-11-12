import { describe, expect, it, vi } from 'vitest'

import {
	derivedAtom,
	effectAtom,
	primitiveAtom,
	type AtomSymbol,
	type EffectAtom,
	type Read,
} from '.'
import { createStore, flushMicrotask, mountCount } from './utils.testing'

describe('mount order within a flush', () => {
	const logUnmount = (events: string[], name: string) => ({
		onMount: () => () => {
			events.push(name)
		},
	})

	describe('transitive', () => {
		const logMount = (order: string[], name: string) => ({
			onMount: () => {
				order.push(name)
			},
		})
		const fixture = (order: string[]) => {
			const flag = primitiveAtom(false)
			const sw = primitiveAtom(false)
			const e = primitiveAtom(1, logMount(order, 'E'))
			const b = primitiveAtom(0, {
				onMount: (_read, write) => {
					order.push('B')
					write(flag, true)
				},
			})
			const m = derivedAtom((read) => (read(flag) ? read(e) : 0))
			const m2 = derivedAtom((read) => (read(sw) ? read(b) : 0))
			return { flag, sw, e, b, m, m2 }
		}
		type Atoms = ReturnType<typeof fixture>
		it.each<{
			name: string
			read: (read: Read, atoms: Atoms) => number
		}>([
			{
				name: 'a mounted intermediate gains the dependency',
				read: (read, { sw, b, m }) => (read(sw) ? read(b) : 0) + read(m),
			},
			{
				name: 'the consumer itself gains the dependency',
				read: (read, { sw, b, flag, e }) =>
					(read(sw) ? read(b) : 0) + (read(flag) ? read(e) : 0),
			},
			{
				name: 'the writer is reached through a mounted intermediate without onMount',
				read: (read, { m2, flag, e }) => (read(flag) ? read(e) : 0) + read(m2),
			},
			{
				name: 'a mounted intermediate is walked before the writer',
				read: (read, { sw, b, m }) => read(m) + (read(sw) ? read(b) : 0),
			},
		])(
			'mounts the new dependency first when $name',
			async ({ read: selectRead }) => {
				const order: string[] = []
				const atoms = fixture(order)
				const a = derivedAtom(
					(read) => selectRead(read, atoms),
					undefined,
					logMount(order, 'A'),
				)
				const store = createStore()
				store.subscribe(atoms.m, () => {})
				store.subscribe(atoms.m2, () => {})
				await flushMicrotask()
				store.subscribe(a, () => {})
				store.send(atoms.sw, true)
				await flushMicrotask()

				expect(order).toEqual(['B', 'E', 'A'])
			},
		)

		it('invalidates a completed walk when a later root relinks a mounted intermediate', async () => {
			const order: string[] = []
			const flag = primitiveAtom(false)
			const dependency = primitiveAtom(1, logMount(order, 'dependency'))
			const middle = derivedAtom((read) => (read(flag) ? read(dependency) : 0))
			const first = derivedAtom(
				(read) => read(middle),
				undefined,
				logMount(order, 'first'),
			)
			const writer = primitiveAtom(0, {
				onMount: (_read, write) => {
					order.push('writer')
					write(flag, true)
				},
			})
			const last = derivedAtom(
				(read) => read(middle) + read(writer),
				undefined,
				logMount(order, 'last'),
			)
			const store = createStore()
			store.subscribe(middle, () => {})
			await flushMicrotask()
			store.subscribe(first, () => {})
			store.subscribe(last, () => {})

			await flushMicrotask()

			expect(order).toEqual(['first', 'writer', 'dependency', 'last'])
		})

		it('mounts reversed dependencies before their new consumer after an onMount write', async () => {
			const order: string[] = []
			const store = createStore()
			const enabled = primitiveAtom(false)
			const reversed = primitiveAtom(false)
			const writer = primitiveAtom(1, {
				onMount: (_read, write) => {
					order.push('writer')
					store.subscribe(middle, () => {})
					write(reversed, true)
				},
			})
			const middle: AtomSymbol<number, never> = derivedAtom(
				(read) => (read(reversed) ? read(root) : read(writer)),
				undefined,
				logMount(order, 'middle'),
			)
			const root: AtomSymbol<number, never> = derivedAtom(
				(read) => (!read(enabled) ? 0 : read(reversed) ? 100 : read(middle)),
				undefined,
				logMount(order, 'root'),
			)
			store.subscribe(root, () => {})
			store.send(enabled, true)

			await flushMicrotask()

			expect(order).toEqual(['writer', 'root', 'middle'])
		})

		it('does not mount a sibling that an onMount write unlinked', async () => {
			const order: string[] = []
			const flag = primitiveAtom(false)
			const keep = primitiveAtom(true)
			const sw = primitiveAtom(false)
			const a = primitiveAtom(1, {
				onMount: (_read, write) => {
					order.push('A')
					write(keep, false)
				},
			})
			const b = primitiveAtom(2, {
				onMount: () => {
					order.push('B')
					return () => {
						order.push('~B')
					}
				},
			})
			const i = derivedAtom(
				(read) => (read(flag) ? read(a) + (read(keep) ? read(b) : 0) : 0),
				undefined,
				logMount(order, 'I'),
			)
			const c = derivedAtom(
				(read) => (read(sw) ? read(i) : 0),
				undefined,
				logMount(order, 'C'),
			)
			const store = createStore()
			store.subscribe(c, () => {})
			store.send(flag, true)
			store.send(sw, true)
			await flushMicrotask()
			await flushMicrotask()

			expect(order).toEqual(['A', 'I', 'C'])
		})

		it('does not mount a sibling unlinked by a write below an intermediate', async () => {
			const order: string[] = []
			const enabled = primitiveAtom(false)
			const keep = primitiveAtom(true)
			const writer = primitiveAtom(1, {
				onMount: (_read, write) => {
					order.push('writer')
					write(keep, false)
				},
			})
			const middle = derivedAtom(
				(read) => read(writer),
				undefined,
				logMount(order, 'middle'),
			)
			const sibling = primitiveAtom(2, logMount(order, 'sibling'))
			const parent = derivedAtom(
				(read) =>
					read(enabled) ? read(middle) + (read(keep) ? read(sibling) : 0) : 0,
				undefined,
				logMount(order, 'parent'),
			)
			const store = createStore()
			store.subscribe(parent, () => {})
			store.send(enabled, true)

			await flushMicrotask()

			expect(order).toEqual(['writer', 'middle', 'parent'])
		})

		it('mounts a dependency gained through an unmounted intermediate before the consumer', async () => {
			const order: string[] = []
			const flag = primitiveAtom(false)
			const sw = primitiveAtom(false)
			const g = primitiveAtom(1, {
				onMount: (_read, write) => {
					order.push('G')
					write(flag, true)
				},
			})
			const i = derivedAtom((read) => read(g), undefined, logMount(order, 'I'))
			const e = primitiveAtom(1, logMount(order, 'E'))
			const c = derivedAtom(
				(read) => (read(sw) ? read(i) : 0) + (read(flag) ? read(e) : 0),
				undefined,
				logMount(order, 'C'),
			)
			const store = createStore()
			store.subscribe(c, () => {})
			store.send(sw, true)
			await flushMicrotask()
			await flushMicrotask()

			expect(order).toEqual(['G', 'I', 'E', 'C'])
		})

		it('keeps a node mounted when user code releases and retains it again during its own walk', async () => {
			const order: string[] = []
			const sw = primitiveAtom(false)
			let unsubscribeN = () => {}
			let unsubscribeP = () => {}
			let tornDown = false
			const store = createStore()
			const d = primitiveAtom(1, {
				onMount: () => {
					order.push('D')
					if (tornDown) return
					tornDown = true
					unsubscribeN()
					unsubscribeP()
					unsubscribeP = store.subscribe(p, () => {})
					return () => {
						order.push('~D')
					}
				},
			})
			const n = derivedAtom((read) => (read(sw) ? read(d) : 0), undefined, {
				onMount: () => {
					order.push('N')
					return () => {
						order.push('~N')
					}
				},
			})
			const p = derivedAtom((read) => read(n), undefined, logMount(order, 'P'))
			unsubscribeN = store.subscribe(n, () => {})
			await flushMicrotask()
			unsubscribeP = store.subscribe(p, () => {})
			store.send(sw, true)
			await flushMicrotask()

			expect(order).toEqual(['N', 'D', 'P'])
		})

		it('mounts the parent after a sibling released and retained again without a write', async () => {
			const order: string[] = []
			let unsubscribeR = () => {}
			let tornDown = false
			const store = createStore()
			const w = primitiveAtom(1, {
				onMount: () => {
					order.push('W')
					return () => {
						order.push('~W')
					}
				},
			})
			const x = primitiveAtom(2, {
				onMount: () => {
					order.push('X')
					if (tornDown) return
					tornDown = true
					unsubscribeR()
					unsubscribeR = store.subscribe(r, () => {})
				},
			})
			const sw = primitiveAtom(false)
			const r = derivedAtom(
				(read) => (read(sw) ? read(w) + read(x) : 0),
				undefined,
				logMount(order, 'R'),
			)
			unsubscribeR = store.subscribe(r, () => {})
			store.send(sw, true)
			store.subscribe(x, () => {})
			await flushMicrotask()

			expect(order).toEqual(['W', 'X', 'R'])
		})
	})

	describe('release bookkeeping', () => {
		const logMountCycle = (events: string[]) => ({
			onMount: () => {
				events.push('mount')
				return () => events.push('unmount')
			},
		})
		const mountWriter = <T>(
			target: ReturnType<typeof primitiveAtom<T>>,
			value: T,
		) =>
			primitiveAtom(0, {
				onMount: (_read, write) => {
					write(target, value)
				},
			})
		const diamond = <Args extends unknown[]>(
			leaf: AtomSymbol<number, Args>,
		) => {
			const sel = primitiveAtom(false)
			const mode = primitiveAtom(false)
			const gated = derivedAtom<number>((read) => (read(sel) ? 0 : read(leaf)))
			const direct = derivedAtom<number>((read) => read(gated))
			const bypass = derivedAtom<number>((read) => read(leaf))
			const joined = derivedAtom<number>((read) => read(gated) + read(bypass))
			const top = derivedAtom<number>((read) =>
				read(mode) ? read(joined) : read(direct),
			)
			return { sel, mode, top }
		}
		it('keeps a dependency mounted when a stale consumer is dropped and another path regains it in the same flush', async () => {
			const events: string[] = []
			const resource = primitiveAtom(0, logMountCycle(events))
			const { sel, mode, top } = diamond(resource)
			const store = createStore()
			store.subscribe(top, () => {})
			await flushMicrotask()
			store.send(sel, true)
			store.send(mode, true)
			await flushMicrotask()

			expect(events).toEqual(['mount'])
		})

		it('keeps a dependency mounted when a mount write regains it after its only stale consumer is dropped', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const trigger = primitiveAtom(false)
			const resource = primitiveAtom(0, logMountCycle(events))
			const writer = mountWriter(trigger, true)
			const gated = derivedAtom<number>((read) =>
				read(sel) ? 0 : read(resource),
			)
			const top = derivedAtom<number>((read) => read(gated))
			const regain = derivedAtom<number>((read) =>
				read(trigger) ? read(resource) : 0,
			)
			const store = createStore()
			store.subscribe(top, () => {})
			store.subscribe(regain, () => {})
			await flushMicrotask()
			store.send(sel, true)
			store.subscribe(writer, () => {})
			await flushMicrotask()

			expect(events).toEqual(['mount'])
		})

		it('never mounts a pending subgraph below a dependency dropped by a stale consumer', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const resource = primitiveAtom(0, logMountCycle(events))
			const left = derivedAtom<number>((read) => read(resource))
			const right = derivedAtom<number>((read) => read(resource))
			const leaf = derivedAtom<number>((read) => read(left) + read(right))
			const gated = derivedAtom<number>((read) => (read(sel) ? 0 : read(leaf)))
			const direct = derivedAtom<number>((read) => read(gated))
			const top = derivedAtom<number>((read) => read(direct))
			const store = createStore()
			store.subscribe(top, () => {})
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toEqual([])
		})

		it('keeps a dependency mounted when its live resource sits below a dropped dependency that is not mounted yet', async () => {
			const events: string[] = []
			const resource = primitiveAtom(0, logMountCycle(events))
			const inner = derivedAtom<number>((read) => read(resource))
			const { sel, mode, top } = diamond(inner)
			const store = createStore()
			const unsubscribeResource = store.subscribe(resource, () => {})
			await flushMicrotask()
			store.subscribe(top, () => {})
			unsubscribeResource()
			store.send(sel, true)
			store.send(mode, true)
			await flushMicrotask()

			expect(events).toEqual(['mount'])
		})

		const gatedPair = () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const resource = primitiveAtom(0, logMountCycle(events))
			const gatedOn = derivedAtom<number>((read) =>
				read(sel) ? read(resource) : 0,
			)
			const gatedOff = derivedAtom<number>((read) =>
				read(sel) ? 0 : read(resource),
			)
			const through = derivedAtom<number>((read) => read(gatedOff))
			return { events, sel, resource, gatedOn, gatedOff, through }
		}
		it.each<{
			name: string
			effect: (atoms: ReturnType<typeof gatedPair>) => EffectAtom
		}>([
			{
				name: 'its selector reads two intermediates that swap the dependency',
				effect: ({ gatedOn, gatedOff }) =>
					effectAtom(
						(read) => read(gatedOn) + read(gatedOff),
						() => {},
					),
			},
			{
				name: 'its body reads two intermediates that swap the dependency',
				effect: ({ gatedOn, gatedOff }) =>
					effectAtom((read) => {
						read(gatedOff)
						read(gatedOn)
					}),
			},
			{
				name: 'it reads the dependency directly once an intermediate below a derived drops it',
				effect: ({ sel, resource, through }) =>
					effectAtom(
						(read) => (read(sel) ? read(resource) : read(through)),
						() => {},
					),
			},
		])(
			'keeps a dependency mounted for an effect consumer when $name',
			async ({ effect }) => {
				const atoms = gatedPair()
				const store = createStore()
				store.mountEffect(effect(atoms))
				await flushMicrotask()
				store.send(atoms.sel, true)
				await flushMicrotask()
				store.send(atoms.sel, false)
				await flushMicrotask()

				expect(atoms.events).toEqual(['mount'])
			},
		)

		const gatedEffect = (
			{ sel, resource }: ReturnType<typeof gatedPair>,
			readWhen: boolean,
		) =>
			effectAtom(
				(read) => (read(sel) === readWhen ? read(resource) : 0),
				() => {},
			)
		it.each<{
			name: string
			mountRoots: (
				store: ReturnType<typeof createStore>,
				atoms: ReturnType<typeof gatedPair>,
			) => void
		}>([
			{
				name: 'two subscriptions',
				mountRoots: (store, { gatedOff, gatedOn }) => {
					store.subscribe(gatedOff, () => {})
					store.subscribe(gatedOn, () => {})
				},
			},
			{
				name: 'two effects',
				mountRoots: (store, atoms) => {
					store.mountEffect(gatedEffect(atoms, false))
					store.mountEffect(gatedEffect(atoms, true))
				},
			},
			{
				name: 'a subscription and an effect',
				mountRoots: (store, atoms) => {
					store.subscribe(atoms.gatedOff, () => {})
					store.mountEffect(gatedEffect(atoms, true))
				},
			},
		])(
			'keeps a dependency mounted when it moves between $name',
			async ({ mountRoots }) => {
				const atoms = gatedPair()
				const store = createStore()
				mountRoots(store, atoms)
				await flushMicrotask()
				store.send(atoms.sel, true)
				await flushMicrotask()
				store.send(atoms.sel, false)
				await flushMicrotask()

				expect(atoms.events).toEqual(['mount'])
			},
		)

		it('tears down a dropped consumer before a dependency it read through a path that stays mounted', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const resource = primitiveAtom(0, logUnmount(events, 'resource'))
			const gated = derivedAtom((read) => (read(sel) ? 0 : read(resource)))
			const shared = derivedAtom((read) => read(gated))
			const consumer = derivedAtom<number>(
				(read) => read(shared),
				undefined,
				logUnmount(events, 'consumer'),
			)
			const dropping = derivedAtom((read) => (read(sel) ? 0 : read(consumer)))
			const store = createStore()
			store.subscribe(dropping, () => {})
			store.subscribe(shared, () => {})
			await flushMicrotask()
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toEqual(['consumer', 'resource'])
		})
	})

	describe('deferred teardown', () => {
		const owning = (events: string[], effect: EffectAtom, name: string) =>
			primitiveAtom(0, {
				onMount: (_read, _write, mountEffect) => {
					mountEffect(effect)
					return () => events.push(name)
				},
			})
		const logSelection = (
			events: string[],
			sel: ReturnType<typeof primitiveAtom<boolean>>,
		) =>
			effectAtom(
				(read) => read(sel),
				(selected) => {
					events.push(`setup ${selected}`)
					return () => events.push(`cleanup ${selected}`)
				},
			)
		const mountWriteOwner = (
			events: string[],
			sel: ReturnType<typeof primitiveAtom<boolean>>,
		) =>
			primitiveAtom(0, {
				onMount: (_read, write, mountEffect) => {
					mountEffect(logSelection(events, sel))
					write(sel, true)
					return () => events.push('owner')
				},
			})
		const selectedReader = (
			sel: ReturnType<typeof primitiveAtom<boolean>>,
			atom: ReturnType<typeof primitiveAtom<number>>,
		) =>
			effectAtom(
				(read) => (read(sel) ? read(atom) : 0),
				() => {},
			)

		it('does not rerun a child effect of an owner released in the flush', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const owner = owning(events, logSelection(events, sel), 'owner')
			const root = derivedAtom((read) => (read(sel) ? 0 : read(owner)))
			const store = createStore()
			store.subscribe(root, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toEqual(['cleanup false', 'owner'])
		})

		it('does not run a child effect whose owner a mount write releases before its first run', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const owner = mountWriteOwner(events, sel)
			const root = derivedAtom((read) => (read(sel) ? 0 : read(owner)))
			const store = createStore()
			store.subscribe(root, () => {})
			await flushMicrotask()

			expect(events).toEqual(['owner'])
		})

		it('does not rerun a child effect whose cleanup releases its owner', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			let unsubscribe = () => {}
			const owner = owning(
				events,
				effectAtom(
					(read) => read(sel),
					(selected) => {
						events.push(`setup ${selected}`)
						return () => {
							events.push(`cleanup ${selected}`)
							unsubscribe()
						}
					},
				),
				'owner',
			)
			const root = derivedAtom((read) => read(owner))
			const store = createStore()
			unsubscribe = store.subscribe(root, () => {})
			await flushMicrotask()
			events.length = 0
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toEqual(['cleanup false', 'owner'])
		})

		it.each<{
			name: string
			owned: (
				events: string[],
				sel: ReturnType<typeof primitiveAtom<boolean>>,
			) => EffectAtom
		}>([
			{ name: 'child', owned: logSelection },
			{
				name: 'grandchild',
				owned: (events, sel) =>
					effectAtom(
						() => 0,
						(_next, _last, _read, _write, mountEffect) => {
							mountEffect(logSelection(events, sel))
						},
					),
			},
		])(
			'resumes a skipped $name effect when its owner is retained again in the flush',
			async ({ owned }) => {
				const events: string[] = []
				const sel = primitiveAtom(false)
				const owner = owning(events, owned(events, sel), 'owner')
				const root = derivedAtom((read) => (read(sel) ? 0 : read(owner)))
				const store = createStore()
				store.subscribe(root, () => {})
				await flushMicrotask()
				store.mountEffect(selectedReader(sel, owner))
				await flushMicrotask()
				events.length = 0
				store.send(sel, true)
				await flushMicrotask()

				expect(events).toEqual(['cleanup false', 'setup true'])
			},
		)

		it('checks each shared owner once when skipping the orphaned children of a deep owner lattice', async () => {
			const depth = 26
			const sel = primitiveAtom(false)
			let runs = 0
			let level: EffectAtom[] = []
			for (let index = 0; index < depth; index++) {
				const owned = level
				const ownerEffect = () =>
					effectAtom(
						(read) => read(sel),
						(_next, _last, _read, _write, mountEffect) => {
							runs++
							for (const child of owned) mountEffect(child)
						},
					)
				level = [ownerEffect(), ownerEffect()]
			}
			const top = level
			const owner = primitiveAtom(0, {
				onMount: (_read, _write, mountEffect) => {
					for (const child of top) mountEffect(child)
				},
			})
			const root = derivedAtom((read) => (read(sel) ? 0 : read(owner)))
			const store = createStore()
			store.subscribe(root, () => {})
			await flushMicrotask()
			runs = 0
			store.send(sel, true)
			await flushMicrotask()

			expect(runs).toBe(0)
		})

		it('runs a child effect that has not run yet when its owner is retained again in the flush', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const owner = mountWriteOwner(events, sel)
			const root = derivedAtom((read) => (read(sel) ? 0 : read(owner)))
			const store = createStore()
			store.mountEffect(selectedReader(sel, owner))
			store.subscribe(root, () => {})
			await flushMicrotask()

			expect(events).toEqual(['setup true'])
		})

		it('keeps deferred teardowns pending when a subscriber releases a reference that is not the last', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const doublySubscribed = primitiveAtom(0)
			const resource = primitiveAtom(0, {
				onMount: () => {
					events.push('mount')
					return () => events.push('unmount')
				},
			})
			const root = derivedAtom((read) => (read(sel) ? 0 : read(resource)))
			const store = createStore()
			store.subscribe(root, () => {})
			store.mountEffect(selectedReader(sel, resource))
			const unsubscribeDoublySubscribed = store.subscribe(
				doublySubscribed,
				() => {},
			)
			store.subscribe(doublySubscribed, () => {})
			store.subscribe(sel, () => unsubscribeDoublySubscribed())
			await flushMicrotask()
			events.length = 0
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toEqual([])
		})

		it('tears down a consumer before a dependency that an owned child still reads', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const dependency = primitiveAtom(0, logUnmount(events, 'dependency'))
			const consumer = derivedAtom<number>(
				(read) => read(dependency),
				undefined,
				logUnmount(events, 'consumer'),
			)
			const owner = owning(
				events,
				effectAtom(
					(read) => read(dependency),
					() => {},
				),
				'owner',
			)
			const root = derivedAtom((read) =>
				read(sel) ? 0 : read(consumer) + read(owner),
			)
			const store = createStore()
			store.subscribe(root, () => {})
			await flushMicrotask()
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toHaveLength(3)
			expect(events.indexOf('consumer')).toBeLessThan(
				events.indexOf('dependency'),
			)
		})

		it('tears down a dependency after a consumer that the teardown of an owner releases', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const dependency = primitiveAtom(1, logUnmount(events, 'dependency'))
			const consumer = derivedAtom<number>(
				(read) => (read(sel) ? 0 : read(dependency)),
				undefined,
				logUnmount(events, 'consumer'),
			)
			const owner = owning(
				events,
				effectAtom(
					(read) => read(consumer),
					() => {},
				),
				'owner',
			)
			const root = derivedAtom((read) => (read(sel) ? 0 : read(owner)))
			const store = createStore()
			store.subscribe(root, () => {})
			await flushMicrotask()
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toHaveLength(3)
			expect(events.indexOf('consumer')).toBeLessThan(
				events.indexOf('dependency'),
			)
		})

		const subscribedRoot = () => {
			const events: string[] = []
			const trigger = primitiveAtom(0)
			const dependency = primitiveAtom(0, logUnmount(events, 'dependency'))
			const root = derivedAtom<number>(
				(read) => read(dependency),
				undefined,
				logUnmount(events, 'root'),
			)
			const store = createStore()
			const unsubscribeRoot = store.subscribe(root, () => {})
			return { events, trigger, dependency, store, unsubscribeRoot }
		}

		it('tears down a root a subscriber unsubscribes at once and its dependency after the callback', async () => {
			const { events, trigger, store, unsubscribeRoot } = subscribedRoot()
			store.subscribe(trigger, () => {
				events.push('callback start')
				unsubscribeRoot()
				events.push('callback end')
			})
			await flushMicrotask()
			store.send(trigger, 1)
			await flushMicrotask()

			expect(events).toEqual([
				'callback start',
				'root',
				'callback end',
				'dependency',
			])
		})

		it('keeps the dependency of an unsubscribed root that the callback subscribes to', async () => {
			const { events, trigger, dependency, store, unsubscribeRoot } =
				subscribedRoot()
			store.subscribe(trigger, () => {
				events.push('callback start')
				unsubscribeRoot()
				store.subscribe(dependency, () => {})
				events.push('callback end')
			})
			await flushMicrotask()
			store.send(trigger, 1)
			await flushMicrotask()

			expect(events).toEqual(['callback start', 'root', 'callback end'])
		})

		it('tears down a deferred consumer before a dependency a subscriber unsubscribes', async () => {
			const events: string[] = []
			const sel = primitiveAtom(false)
			const dependency = primitiveAtom(0, logUnmount(events, 'dependency'))
			const consumer = derivedAtom<number>(
				(read) => read(dependency),
				undefined,
				logUnmount(events, 'consumer'),
			)
			const root = derivedAtom((read) => (read(sel) ? 0 : read(consumer)))
			const store = createStore()
			store.subscribe(root, () => {})
			const unsubscribeDependency = store.subscribe(dependency, () => {})
			store.subscribe(sel, () => unsubscribeDependency())
			await flushMicrotask()
			store.send(sel, true)
			await flushMicrotask()

			expect(events).toEqual(['consumer', 'dependency'])
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
		const cleanupSubscriber = primitiveAtom(0, {
			onMount: () => () => {
				store.subscribe(derived, () => {})
			},
		})
		const gate = derivedAtom((read) =>
			read(flag) ? read(cleanupSubscriber) : 0,
		)
		const store = createStore()
		store.peek(derived)
		store.subscribe(gate, () => {})
		store.subscribe(middle, () => {})
		await flushMicrotask()
		store.send(flag, false)
		await flushMicrotask()
		expect(nestedSubscribe).toHaveBeenCalledOnce()
		expect(mountCount(store, derived)).toBe(2)
		expect(evaluate).toHaveBeenCalledTimes(4)
	})

	const swappable = () => {
		const events: string[] = []
		const resource = (name: string, value: number) =>
			primitiveAtom(value, {
				onMount: (_read, _write, mountEffect) => {
					events.push(`${name} mount`)
					mountEffect(
						effectAtom(() => {
							events.push(`${name} setup`)
							return () => events.push(`${name} cleanup`)
						}),
					)
					return () => events.push(`${name} unmount`)
				},
			})
		const first = resource('first', 1)
		const second = resource('second', 2)
		const selectFirst = primitiveAtom(true)
		const select = (read: Read) =>
			read(selectFirst) ? read(first) : read(second)
		return { events, selectFirst, select }
	}

	it('keeps reconciling when a later mount write switches a mounted consumer', async () => {
		const { events, selectFirst, select } = swappable()
		const consumer = derivedAtom(select)
		const trigger = primitiveAtom(0, {
			onMount: (_read, write) => {
				write(selectFirst, false)
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
			'second mount',
			'second setup',
			'first cleanup',
			'first unmount',
		])

		unsubscribeTrigger()
		unsubscribe()
		expect(events.slice(6)).toEqual(['second cleanup', 'second unmount'])
	})

	it.each<{
		name: string
		root: (
			outer: AtomSymbol<string | null | undefined, never>,
		) => AtomSymbol<string | null | undefined, never>
	}>([
		{ name: 'subscribed', root: (outer) => outer },
		{
			name: 'read by a subscribed instance',
			root: (outer) => derivedAtom((read) => read(outer)),
		},
	])(
		're-runs consumers before guarded dependencies when the consumer is $name',
		async ({ root }) => {
			const items = primitiveAtom([{ name: 'a' }])
			const index = primitiveAtom(0)
			const valid = primitiveAtom(true)
			const cleanupDetail = vi.fn()
			const detailGetter = vi.fn((read: Read) => read(items)[read(index)]?.name)
			const detail = derivedAtom(detailGetter, () => {}, {
				onMount: () => cleanupDetail,
			})
			const outer = derivedAtom((read) => (read(valid) ? read(detail) : null))
			const store = createStore()
			const unsubscribe = store.subscribe(root(outer), () => {})
			await flushMicrotask()
			expect(detailGetter).toHaveBeenCalledOnce()
			store.send(index, 3)
			store.send(valid, false)
			await flushMicrotask()
			expect(detailGetter).toHaveBeenCalledOnce()
			expect(cleanupDetail).toHaveBeenCalledOnce()
			expect(store.peek(outer)).toBeNull()
			unsubscribe()
		},
	)

	it('stops walking a node released by a mount write below it', async () => {
		const flag = primitiveAtom(false)
		const source = primitiveAtom(0)
		const writer = primitiveAtom(0, {
			onMount: (_read, write) => {
				write(source, 1)
			},
		})
		const released = derivedAtom((read) =>
			read(flag) ? read(writer) + read(source) : read(source),
		)
		const consumer = derivedAtom((read) =>
			read(source) === 0 ? read(released) : -1,
		)
		const seen: number[] = []
		const store = createStore()
		store.subscribe(consumer, () => {})
		store.mountEffect(
			effectAtom((read) => {
				seen.push(read(consumer))
			}),
		)
		store.send(flag, true)
		await flushMicrotask()
		expect(seen).toEqual([-1])
		expect(mountCount(store, released)).toBe(0)
		expect(mountCount(store, writer)).toBe(0)
	})
})
