import type {
	AtomSymbol,
	Effect,
	FamilyRetention,
	ResolvedAtom,
} from '../atoms'

export type FamilyStorage<S, Key> =
	| { type: 'hash'; map: Map<unknown, Instance<S>> }
	| { type: 'eq'; pairs: [Key, Instance<S>][] }

export type FamilySlot =
	| (Extract<FamilyStorage<any, unknown>, { type: 'hash' }> & {
			hashedKey: unknown
	  })
	| Extract<FamilyStorage<any, unknown>, { type: 'eq' }>

type EvictableRetention = Extract<
	FamilyRetention,
	{ type: 'immediate' | 'timed' }
>

type FamilyEntry = FamilySlot & { retention: EvictableRetention }

export type MountLifecycle = { cleanup?: () => void }
export type EffectLifecycle<S> = MountLifecycle & {
	readonly value: S
	readonly instance: Instance<S>
	cleaning: boolean
	deferredReleases: Set<DeferredRelease>
	dependencies: Set<Instance<any>>
	/**
	 * Everything the effect's instance reached when the effect ran or
	 * at the end of a later flush, until cleanup.
	 */
	readClosure: Set<Instance<any>>
}

export type DeferredRelease = {
	dependency: Instance<any>
	owners: Set<EffectLifecycle<any>>
}

type Registration = { references: number }

export type Delivery = {
	instance: Instance<any>
	callback: () => void
	registration: Registration
}

type Freshness =
	| { type: 'dirty' }
	| { type: 'evaluating' }
	| { type: 'clean'; validatedAt: number }

export type Instance<S> = {
	handle: ResolvedAtom<S, any> | undefined
	symbol: AtomSymbol<S, any>
	familyEntry: FamilyEntry | undefined
	familyRemovalTimeout: ReturnType<typeof setTimeout> | undefined
	freshness: Freshness
	value: S
	effectLifecycle: EffectLifecycle<S> | undefined
	mountLifecycle: MountLifecycle | undefined
	version: number
	depVersions: Map<Instance<any>, number>
	mountedSubs: Set<Instance<any>>
	subscriptions: Map<() => void, Registration>
	mountCount: number
	mountedDeps: Set<Instance<any>>
	deferredOwners: Set<DeferredRelease>
}

export type Tasks = {
	mounts: Set<Instance<any>>
	primitives: Map<Instance<any>, any>
	effects: Set<Instance<any>>
	reconciles: Set<Instance<any>>
	pendingFamilyEvictions: Set<Instance<any>>
}

export type Transition = {
	instance: Instance<any>
	effect: Effect<any>
	next: any
	previous: EffectLifecycle<any> | undefined
	mountLifecycle: MountLifecycle | undefined
}

export type FlushPhase = {
	mounts: Set<Instance<any>> | undefined
	reconciles: Set<Instance<any>> | undefined
	effects: Set<Instance<any>> | undefined
	familyEvictions: Set<Instance<any>> | undefined
	mountWrites: Map<Instance<any>, any> | undefined
	releases: Instance<any>[] | undefined
}
