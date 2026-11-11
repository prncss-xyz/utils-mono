import { expectTypeOf, it } from 'vitest'

import {
	createStore,
	effectAtom,
	hydrate,
	primitiveAtom,
	type EffectAtom,
	type EffectBody,
	type EffectTracker,
	type MountEffect,
	type OnMount,
	type Read,
	type Write,
} from '.'
import { useAtom, useAtomValue, useMountEffect, useSetAtom } from '../react'

it('infers tracked values and exposes effect body operations', () => {
	const value = primitiveAtom(0)
	expectTypeOf<Parameters<EffectTracker<number>>>().toEqualTypeOf<[Read]>()
	const effect = effectAtom(
		(read) => read(value),
		(next, last, read, write, mountEffect) => {
			expectTypeOf(next).toEqualTypeOf<number>()
			expectTypeOf(last).toEqualTypeOf<number | undefined>()
			expectTypeOf(read).toEqualTypeOf<Read>()
			expectTypeOf(write).toEqualTypeOf<Write>()
			expectTypeOf(mountEffect).toEqualTypeOf<MountEffect>()
			return () => {}
		},
	)
	expectTypeOf(effect).toEqualTypeOf<EffectAtom>()
	expectTypeOf(effect.body).toEqualTypeOf<OnMount>()
	effect.body(
		() => 0 as never,
		() => {},
		() => {},
	)
	effectAtom(
		// @ts-expect-error the tracked value and body argument types must agree
		(read) => read(value),
		(_next: string, _last: string | undefined) => {},
	)
})

it('exposes only mounting operations for effect atoms', () => {
	const effect = effectAtom(() => {})
	const value = primitiveAtom(0)
	const store = createStore()
	expectTypeOf(effect).toEqualTypeOf<EffectAtom>()
	expectTypeOf(store.mountEffect(effect)).toEqualTypeOf<() => void>()
	expectTypeOf(useMountEffect(effect)).toEqualTypeOf<void>()
	const tracker: EffectTracker = (read) => {
		read(value)
	}
	expectTypeOf(effectAtom(tracker)).toEqualTypeOf<EffectAtom>()
	// @ts-expect-error trackers receive only read
	effectAtom((_read: Read, _write: Write) => {})
	const body: EffectBody<number> = (
		_next,
		_last,
		read: Read,
		write: Write,
		mountEffect: MountEffect,
	) => {
		read(value)
		write(value, 1)
		expectTypeOf(mountEffect(effect)).toEqualTypeOf<void>()
		// @ts-expect-error effects have no readable value
		read(effect)
		// @ts-expect-error effects are not writable
		write(effect)
		// @ts-expect-error only effects can be mounted
		mountEffect(value)
	}
	expectTypeOf(
		effectAtom((read) => read(value), body),
	).toEqualTypeOf<EffectAtom>()
	// @ts-expect-error effects have no readable value
	store.peek(effect)
	// @ts-expect-error effects are not writable
	store.send(effect)
	// @ts-expect-error effects have no resolved value handle
	store.resolve(effect)
	// @ts-expect-error value subscriptions do not accept effects
	store.subscribe(effect, () => {})
	// @ts-expect-error only effects can be mounted
	store.mountEffect(value)
	// @ts-expect-error effects cannot be hydrated
	hydrate(effect)
	// @ts-expect-error effects cannot be hydrated through raw entries
	createStore([[effect]])
	// @ts-expect-error effects have no readable value
	useAtom(effect)
	// @ts-expect-error effects have no readable value
	useAtomValue(effect)
	// @ts-expect-error effects are not writable
	useSetAtom(effect)
	// @ts-expect-error only effects can be mounted
	useMountEffect(value)
	// @ts-expect-error ordinary atoms no longer have an effect option
	primitiveAtom(0, { effect: () => {} })
})
