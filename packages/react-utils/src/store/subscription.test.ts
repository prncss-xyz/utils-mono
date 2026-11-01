import { describe, expect, it, vi } from 'vitest'

import {
	atomFamily,
	createStore,
	derivedAtom,
	primitiveAtom,
	TRANSIENT,
	type AtomSymbol,
	type ResolvedAtom,
} from './store'

const modes = [
	'store',
	'resolved atom',
	'family store',
	'resolved family',
	'mixed family',
	'transient handle',
] as const

const setup = (
	mode: (typeof modes)[number],
	atom: AtomSymbol<number, never>,
) => {
	const store = createStore()
	const family = atomFamily(() => ({ ...atom }), {
		TTL: mode === 'transient handle' ? TRANSIENT : 0,
	})
	const handle = store.resolve(family, 'key')
	const direct: ResolvedAtom<number, never> = {
		peek: () => store.peek(atom),
		send: (...args) => store.send(atom, ...args),
		subscribe: (notify) => store.subscribe(atom, notify),
	}
	const familyDirect: ResolvedAtom<number, never> = {
		peek: () => store.peek(family, 'key'),
		send: (...args) => store.send(family, 'key', ...args),
		subscribe: (notify) => store.subscribe(family, 'key', notify),
	}
	const target =
		mode === 'store'
			? direct
			: mode === 'resolved atom'
				? store.resolve(atom)
				: mode === 'family store'
					? familyDirect
					: handle
	return {
		store,
		target,
		subscribeOther:
			mode === 'mixed family' ? familyDirect.subscribe : target.subscribe,
	}
}

describe.each(modes)('%s subscription references', (mode) => {
	it.each([0, 1])(
		'delivers once and independently releases duplicate callbacks (first disposer: %s)',
		async (first) => {
			const source = primitiveAtom(0)
			const { store, target, subscribeOther } = setup(
				mode,
				derivedAtom((read) => read(source)),
			)
			const notify = vi.fn()
			const releases = [target.subscribe(notify), subscribeOther(notify)]
			await Promise.resolve()

			store.send(source, 1)
			await Promise.resolve()
			expect(notify).toHaveBeenCalledTimes(1)

			releases[first]!()
			releases[first]!()
			store.send(source, 2)
			await Promise.resolve()
			expect(notify).toHaveBeenCalledTimes(2)

			releases[1 - first]!()
			releases[1 - first]!()
			store.send(source, 3)
			await Promise.resolve()
			expect(notify).toHaveBeenCalledTimes(2)
		},
	)

	it('preserves consumer and dependency lifecycles until the final reference', async () => {
		const events: string[] = []
		const source = primitiveAtom(0, {
			onMount: () => {
				events.push('source mount')
				return () => events.push('source cleanup')
			},
		})
		const atom = derivedAtom((read) => read(source), undefined, {
			onMount: () => {
				events.push('consumer mount')
				return () => events.push('consumer cleanup')
			},
			effect: () => {
				events.push('effect setup')
				return () => events.push('effect cleanup')
			},
		})
		const { target, subscribeOther } = setup(mode, atom)
		const notify = vi.fn()
		const release = target.subscribe(notify)
		const releaseOther = subscribeOther(notify)
		await Promise.resolve()
		expect(events).toEqual(['source mount', 'consumer mount', 'effect setup'])
		events.length = 0

		release()
		release()
		await Promise.resolve()
		expect(events).toEqual([])

		releaseOther()
		releaseOther()
		await Promise.resolve()
		expect(events).toEqual([
			'effect cleanup',
			'consumer cleanup',
			'source cleanup',
		])
	})

	it('keeps a snapshotted registration active across reference count changes', async () => {
		const source = primitiveAtom(0)
		const { store, target, subscribeOther } = setup(
			mode,
			derivedAtom((read) => read(source)),
		)
		const later = vi.fn()
		let releaseAdded = () => {}
		const releaseEarlier = target.subscribe(() => {
			releaseLater()
			releaseAdded = subscribeOther(later)
		})
		const releaseLater = target.subscribe(later)
		const releaseOther = subscribeOther(later)
		await Promise.resolve()

		store.send(source, 1)
		await Promise.resolve()
		expect(later).toHaveBeenCalledTimes(1)

		releaseEarlier()
		releaseLater()
		releaseOther()
		releaseAdded()
	})

	it('does not revive a removed snapshot registration when the callback is re-added', async () => {
		const source = primitiveAtom(0)
		const { store, target, subscribeOther } = setup(
			mode,
			derivedAtom((read) => read(source)),
		)
		const later = vi.fn()
		let releaseAdded = () => {}
		const releaseEarlier = target.subscribe(() => {
			releaseLater()
			releaseOther()
			releaseAdded = subscribeOther(later)
		})
		const releaseLater = target.subscribe(later)
		const releaseOther = subscribeOther(later)
		await Promise.resolve()

		store.send(source, 1)
		await Promise.resolve()
		expect(later).not.toHaveBeenCalled()

		releaseEarlier()
		releaseLater()
		releaseOther()
		store.send(source, 2)
		await Promise.resolve()
		expect(later).toHaveBeenCalledTimes(1)
		releaseAdded()
	})
})
