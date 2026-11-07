import type { Hydrate, Store, ValidHydrate } from '../atoms'
import { createRuntime } from './createRuntime'

export {
	TRANSIENT,
	atomFamily,
	derivedAtom,
	effectAtom,
	hydrate,
	primitiveAtom,
	type AtomFamily,
	type AtomFamilyOptions,
	type AtomOptions,
	type AtomSymbol,
	type EffectAtom,
	type EffectBody,
	type EffectTracker,
	type MountEffect,
	type Hydrate,
	type OnMount,
	type PrimitiveSymbol,
	type Read,
	type ResolvedAtom,
	type Store,
	type ValidHydrate,
	type Write,
} from '../atoms'

export function createStore(): Store
export function createStore<
	const Entries extends readonly (readonly unknown[])[],
>(hydrate: Entries & ValidHydrate<Entries>): Store
export function createStore(hydrate?: Hydrate) {
	return createRuntime(hydrate).store
}
