import type {
	AtomSymbol,
	EffectAtom,
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

export type MountLifecycle = {
	cleanup?: () => void
	children: Instance<any>[]
	active: boolean
}

type Registration = { references: number }

export type Delivery = {
	instance: Instance<any>
	callback: () => void
	registration: Registration
	version: number
}

/**
 * - `dirty`: the getter must run.
 * - `check`: a transitive dependency changed; the getter runs only if a
 *   dependency's version changed.
 * - `evaluating`: the getter is running; reading the instance is a cycle.
 * - `clean`: the value is current while mounted, or was validated at
 *   `validatedAt` while unmounted.
 */
type Freshness =
	| { type: 'dirty' }
	| { type: 'check' }
	| { type: 'evaluating' }
	| { type: 'clean'; validatedAt: number }

export type Instance<S> = {
	handle: ResolvedAtom<S, any> | undefined
	symbol: AtomSymbol<S, any> | EffectAtom
	/**
	 * Eviction bookkeeping of a member of an evicting family. Cleared on
	 * eviction, and by a write to a readable member, which then is never evicted.
	 */
	familyEntry: FamilyEntry | undefined
	familyRemovalTimeout: ReturnType<typeof setTimeout> | undefined
	freshness: Freshness
	value: S
	effectLifecycle: MountLifecycle | undefined
	mountLifecycle: MountLifecycle | undefined
	version: number
	depVersions: Map<Instance<any>, number> | undefined
	mountedSubs: Set<Instance<any>> | undefined
	subscriptions: Map<() => void, Registration> | undefined
	mountCount: number
	mountedDeps: Set<Instance<any>> | undefined
	owners: Map<Instance<any>, number> | undefined
}

export type Tasks = {
	mounts: Set<Instance<any>>
	primitives: Map<Instance<any>, any>
	effects: Set<Instance<any>>
	pendingFamilyEvictions: Set<Instance<any>>
}

export type FlushPhase = {
	mounts: Set<Instance<any>> | undefined
	effects: Set<Instance<any>> | undefined
	runningEffect: Instance<any> | undefined
	familyEvictions: Set<Instance<any>> | undefined
	mountWrites: Map<Instance<any>, any> | undefined
	teardowns: Instance<any>[] | undefined
	/**
	 * The references released in this flush on behalf of a consumer or an
	 * owner, as pairs of that holder and the released instance.
	 */
	droppedEdges: Instance<any>[] | undefined
}
