import { expect, it } from 'vitest'

import {
	createStore,
	derivedAtom,
	primitiveAtom,
	type AtomSymbol,
	type Read,
} from './store'

const primitiveCount = 3
const derivedCount = 8
const stepCount = 60
const seedCount = 2000

const random = (seed: number) => () =>
	(seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

type Formula = (get: (index: number) => number) => number

it('matches a reference evaluation across random derived graphs', async () => {
	for (let seed = 1; seed <= seedCount; seed++) {
		const next = random(seed)
		const pick = (length: number) => Math.floor(next() * length)
		const store = createStore()
		const primitives = Array.from({ length: primitiveCount }, () =>
			primitiveAtom(0),
		)
		const nodes = [...primitives] as AtomSymbol<number, never>[]
		const formulas: Formula[] = primitives.map(
			(_, index) => (get) => get(index),
		)
		for (let k = 0; k < derivedCount; k++) {
			const [a, b, c] = [
				pick(nodes.length),
				pick(nodes.length),
				pick(nodes.length),
			]
			const modulus = pick(3) + 2
			const formula: Formula = (get) =>
				get(a) % modulus === 0 ? get(b) : get(c) % modulus
			formulas.push(formula)
			nodes.push(
				derivedAtom((read: Read) => formula((index) => read(nodes[index]!))),
			)
		}
		const reference = (index: number): number =>
			formulas[index]!((dep) =>
				dep < primitiveCount ? store.peek(primitives[dep]!) : reference(dep),
			)
		const pickDerived = () => primitiveCount + pick(derivedCount)
		const unsubscribes: (() => void)[] = []
		for (let step = 0; step < stepCount; step++) {
			const op = next()
			if (op < 0.3) store.send(primitives[pick(primitiveCount)]!, pick(5))
			else if (op < 0.45)
				unsubscribes.push(store.subscribe(nodes[pickDerived()]!, () => {}))
			else if (op < 0.55 && unsubscribes.length > 0)
				unsubscribes.splice(pick(unsubscribes.length), 1)[0]!()
			else if (op < 0.75) await Promise.resolve()
			else {
				const index = pickDerived()
				expect(
					store.peek(nodes[index]!),
					`seed ${seed} step ${step} node ${index}`,
				).toBe(reference(index))
			}
		}
	}
})
