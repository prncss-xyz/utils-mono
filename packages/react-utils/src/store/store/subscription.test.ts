import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
	atomFamily,
	createStore,
	derivedAtom,
	effectAtom,
	primitiveAtom,
	TRANSIENT,
	type AtomSymbol,
	type ResolvedAtom,
} from '.'
import { flushMicrotask, type Value } from './utils.testing'

type Subscribable = Pick<ResolvedAtom<number, never>, 'subscribe'>

type ModeContext = {
	direct: Subscribable
	familyDirect: Subscribable
	handle: () => Subscribable
	atomHandle: () => Subscribable
}

type ModeConfig = {
	TTL?: number
	target: (context: ModeContext) => Subscribable
	other?: (context: ModeContext) => Subscribable['subscribe']
}

const modeConfigs = {
	store: { target: ({ direct }) => direct },
	'resolved atom': {
		target: ({ atomHandle }) => atomHandle(),
	},
	'family store': {
		target: ({ familyDirect }) => familyDirect,
	},
	'resolved family': { target: ({ handle }) => handle() },
	'mixed family': {
		target: ({ handle }) => handle(),
		other: ({ familyDirect }) => familyDirect.subscribe,
	},
	'transient handle': {
		TTL: TRANSIENT,
		target: ({ handle }) => handle(),
	},
} satisfies Record<string, ModeConfig>

type Mode = keyof typeof modeConfigs
const modes = Object.keys(modeConfigs) as Mode[]

const setup = (mode: Mode, atom: AtomSymbol<number, never>) => {
	const config: ModeConfig = modeConfigs[mode]
	const store = createStore()
	const family = atomFamily(() => ({ ...atom }), { TTL: config.TTL ?? 0 })
	const context: ModeContext = {
		direct: { subscribe: (notify) => store.subscribe(atom, notify) },
		familyDirect: {
			subscribe: (notify) => store.subscribe(family, 'key', notify),
		},
		handle: () => store.resolve(family, 'key'),
		atomHandle: () => store.resolve(atom),
	}
	const target = config.target(context)
	return {
		store,
		target,
		subscribeOther: config.other?.(context) ?? target.subscribe,
	}
}

type Action =
	| { type: 'unsubscribe'; handle: number }
	| { type: 'subscribe'; callback: number; other: boolean }

const action: fc.Arbitrary<Action> = fc.oneof(
	fc.record({
		type: fc.constant('unsubscribe' as const),
		handle: fc.nat({ max: 30 }),
	}),
	fc.record({
		type: fc.constant('subscribe' as const),
		callback: fc.nat({ max: 2 }),
		other: fc.boolean(),
	}),
)

const operation = fc.oneof(
	{ weight: 4, arbitrary: action },
	{ weight: 3, arbitrary: fc.record({ type: fc.constant('write' as const) }) },
	{ weight: 4, arbitrary: fc.record({ type: fc.constant('yield' as const) }) },
)

const scripts = fc.array(fc.array(action, { maxLength: 3 }), {
	minLength: 3,
	maxLength: 3,
})

type Registration = { references: number }

/**
 * Models subscriptions as a registration per distinct callback. A notification
 * delivers to a snapshot of registrations, skipping those removed or replaced
 * before their turn.
 */
async function run(
	mode: Mode,
	scripts: Action[][],
	operations: Value<typeof operation>[],
) {
	const source = primitiveAtom(0)
	const events: string[] = []
	const live = new Set<string>()
	const violations: string[] = []
	const resource = (name: string, requires: string[], forbids: string[]) => ({
		start: () => {
			events.push(`${name} start`)
			if (live.has(name)) violations.push(`${name} started twice`)
			for (const other of requires)
				if (!live.has(other)) violations.push(`${name} started before ${other}`)
			live.add(name)
		},
		stop: () => {
			events.push(`${name} stop`)
			if (!live.delete(name)) violations.push(`${name} stopped twice`)
			for (const other of forbids)
				if (live.has(other)) violations.push(`${name} stopped before ${other}`)
		},
	})
	const sourceMount = resource('source mount', [], ['consumer mount', 'effect'])
	const consumerMount = resource('consumer mount', ['source mount'], ['effect'])
	const effect = resource('effect', ['consumer mount'], [])
	const atom = derivedAtom((read) => read(source), undefined, {
		onMount: (_get, _set, mountEffect) => {
			consumerMount.start()
			mountEffect(
				effectAtom(() => {
					effect.start()
					return effect.stop
				}),
			)
			return consumerMount.stop
		},
	})
	source.onMount = () => {
		sourceMount.start()
		return sourceMount.stop
	}
	const { store, target, subscribeOther } = setup(mode, atom)

	const calls: number[] = []
	const expected: number[] = []
	const releases: (() => void)[] = []
	const history: string[] = []
	const report = (label: string) =>
		`${label}\nsteps:\n${history.join('\n')}\nevents:\n${events.join('\n')}`
	const model: {
		registration: Registration
		callback: number
		active: boolean
	}[] = []
	const registrations = new Map<number, Registration>()

	const callbacks: (() => void)[] = scripts.map((script, id) => () => {
		calls.push(id)
		for (const step of script) applyReal(step)
	})
	const applyReal = (step: Action) => {
		if (step.type === 'subscribe') {
			releases.push(
				(step.other ? subscribeOther : target.subscribe)(
					callbacks[step.callback]!,
				),
			)
			return
		}
		if (releases.length > 0) releases[step.handle % releases.length]!()
	}
	const applyModel = (step: Action) => {
		if (step.type === 'subscribe') {
			let registration = registrations.get(step.callback)
			if (!registration) {
				registration = { references: 0 }
				registrations.set(step.callback, registration)
			}
			registration.references++
			model.push({ registration, callback: step.callback, active: true })
			return
		}
		if (model.length === 0) return
		const handle = model[step.handle % model.length]!
		if (!handle.active) return
		handle.active = false
		if (--handle.registration.references === 0)
			registrations.delete(handle.callback)
	}

	let counter = 0
	let written = false
	for (const [index, step] of operations.entries()) {
		const label = `step ${index} ${JSON.stringify(step)}`
		history.push(label)
		switch (step.type) {
			case 'write':
				store.send(source, ++counter)
				written = true
				break
			case 'yield': {
				if (written) {
					const snapshot = [...registrations]
					for (const [callback, registration] of snapshot)
						if (registrations.get(callback) === registration) {
							expected.push(callback)
							for (const inner of scripts[callback]!) applyModel(inner)
						}
				}
				written = false
				await flushMicrotask()
				expect(calls, report(`${label}: delivered callbacks`)).toEqual(expected)
				expect(violations, report(label)).toEqual([])
				const active = model.some(({ active }) => active)
				expect(live.has('source mount'), report(`${label}: source`)).toBe(
					active,
				)
				expect(live.has('consumer mount'), report(`${label}: consumer`)).toBe(
					active,
				)
				expect(live.has('effect'), report(`${label}: effect`)).toBe(active)
				break
			}
			default:
				applyReal(step)
				applyModel(step)
		}
	}
	const releaseAll = () => {
		for (const release of releases) release()
	}
	releaseAll()
	releaseAll()
	expect(violations, report('after releasing twice')).toEqual([])
	expect([...live], report('resources outliving all releases')).toEqual([])
}

describe.each(modes)('%s subscription references', (mode) => {
	it('delivers each distinct callback once per update to a snapshot of registrations', async () => {
		await fc.assert(
			fc.asyncProperty(
				scripts,
				fc.array(operation, { maxLength: 30 }),
				(scripts, operations) => run(mode, scripts, operations),
			),
			{
				numRuns: 200,
				examples: [
					[
						[
							[
								{ type: 'unsubscribe', handle: 15 },
								{ type: 'subscribe', callback: 1, other: false },
							],
							[],
							[],
						],
						[
							{ type: 'subscribe', callback: 0, other: false },
							{ type: 'write' },
							{ type: 'subscribe', callback: 1, other: false },
							{ type: 'yield' },
						],
					],
				],
			},
		)
	}, 15_000)
})
