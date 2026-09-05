import { describe, expect, it } from 'vitest'

import { findLeaf, insertLeaf, removeLeaf } from './lattice'

type Entry = Readonly<{ symbol: symbol; value: unknown }>
type Leaf = Readonly<{
	symbol: symbol
	scopes: readonly Entry[]
	name: string
}>
type Step = {
	readonly type: 'step'
	readonly symbol: symbol
	readonly values: Map<unknown, Leaf | Step>
}

const rootSymbol = Symbol('root')
const firstSymbol = Symbol('first')
const secondSymbol = Symbol('second')
const conflictingSymbol = Symbol('conflicting')

const leaf = (name: string, scopes: readonly Entry[] = []): Leaf => ({
	symbol: rootSymbol,
	scopes,
	name,
})

const resolver = (values: ReadonlyMap<symbol, unknown>) => ({
	resolveScope: (symbol: symbol) => values.get(symbol),
})

describe('scope lattice', () => {
	it('builds an ordered branch terminating at the exact leaf', () => {
		const target = leaf('target', [
			{ symbol: firstSymbol, value: 'first' },
			{ symbol: secondSymbol, value: 'second' },
		])

		const contents = new Map<symbol, Leaf | Step>()

		insertLeaf(contents, target)

		const root = contents.get(rootSymbol) as Step
		const child = root.values.get('first') as Step

		expect(root).toMatchObject({ type: 'step', symbol: firstSymbol })
		expect(child).toMatchObject({ type: 'step', symbol: secondSymbol })
		expect(child.values.get('second')).toBe(target)
	})

	it('finds matching branches, misses absent branches, and supports direct roots', () => {
		const target = leaf('target', [
			{ symbol: firstSymbol, value: 'first' },
			{ symbol: secondSymbol, value: 'second' },
		])
		const contents = new Map<symbol, Leaf | Step>()
		insertLeaf(contents, target)
		const root = contents.get(rootSymbol)

		expect(
			findLeaf(
				resolver(
					new Map([
						[firstSymbol, 'first'],
						[secondSymbol, 'second'],
					]),
				),
				root,
			),
		).toBe(target)
		expect(
			findLeaf(resolver(new Map([[firstSymbol, 'missing']])), root),
		).toBeUndefined()
		expect(findLeaf(resolver(new Map()), leaf('direct'))?.name).toBe('direct')
	})

	it('shares common prefixes while preserving distinct value branches', () => {
		const contents = new Map<symbol, Leaf | Step>()
		const left = leaf('left', [
			{ symbol: firstSymbol, value: 'shared' },
			{ symbol: secondSymbol, value: 'left' },
		])
		const right = leaf('right', [
			{ symbol: firstSymbol, value: 'shared' },
			{ symbol: secondSymbol, value: 'right' },
		])

		insertLeaf(contents, left)
		insertLeaf(contents, right)

		const root = contents.get(rootSymbol) as Step
		const shared = root.values.get('shared') as Step
		expect(shared.values.get('left')).toBe(left)
		expect(shared.values.get('right')).toBe(right)
	})

	it('stores and finds a zero-path leaf directly', () => {
		const contents = new Map<symbol, Leaf | Step>()
		const direct = leaf('direct')

		insertLeaf(contents, direct)

		expect(contents.get(rootSymbol)).toBe(direct)
		expect(findLeaf(resolver(new Map()), contents.get(rootSymbol))).toBe(direct)
	})

	it('rejects incompatible step symbols and prefix collisions', () => {
		const contents = new Map<symbol, Leaf | Step>()
		insertLeaf(
			contents,
			leaf('existing', [
				{ symbol: firstSymbol, value: 'shared' },
				{ symbol: secondSymbol, value: 'value' },
			]),
		)

		expect(() =>
			insertLeaf(
				contents,
				leaf('conflict', [
					{ symbol: firstSymbol, value: 'shared' },
					{ symbol: conflictingSymbol, value: 'other' },
				]),
			),
		).toThrow('lattice invariant: conflicting step symbol')
		expect(() =>
			insertLeaf(
				contents,
				leaf('prefix', [{ symbol: firstSymbol, value: 'shared' }]),
			),
		).toThrow('lattice invariant: leaf prefix collision')

		const directContents = new Map<symbol, Leaf | Step>()
		insertLeaf(directContents, leaf('direct'))
		expect(() =>
			insertLeaf(
				directContents,
				leaf('scoped', [{ symbol: firstSymbol, value: 'value' }]),
			),
		).toThrow('lattice invariant: leaf prefix collision')
	})

	it('removes a direct root only when leaf identity matches', () => {
		const contents = new Map<symbol, Leaf | Step>()
		const direct = leaf('direct')
		insertLeaf(contents, direct)

		expect(() => removeLeaf(contents, leaf('imposter'))).toThrow(
			'lattice invariant: root identity is mismatched',
		)
		removeLeaf(contents, direct)
		expect(contents.has(rootSymbol)).toBe(false)
	})

	it('prunes empty ancestors while preserving a sibling branch', () => {
		const contents = new Map<symbol, Leaf | Step>()
		const left = leaf('left', [
			{ symbol: firstSymbol, value: 'shared' },
			{ symbol: secondSymbol, value: 'left' },
		])
		const right = leaf('right', [
			{ symbol: firstSymbol, value: 'shared' },
			{ symbol: secondSymbol, value: 'right' },
		])
		insertLeaf(contents, left)
		insertLeaf(contents, right)

		removeLeaf(contents, left)

		const root = contents.get(rootSymbol) as Step
		const shared = root.values.get('shared') as Step
		expect(shared.values.has('left')).toBe(false)
		expect(shared.values.get('right')).toBe(right)
		removeLeaf(contents, right)
		expect(contents.has(rootSymbol)).toBe(false)
	})

	it('rejects missing, mismatched, and wrong-identity removal paths', () => {
		const target = leaf('target', [{ symbol: firstSymbol, value: 'value' }])
		const contents = new Map<symbol, Leaf | Step>()

		expect(() => removeLeaf(contents, target)).toThrow(
			'lattice invariant: root is missing',
		)
		insertLeaf(contents, target)
		expect(() =>
			removeLeaf(
				contents,
				leaf('mismatched', [{ symbol: secondSymbol, value: 'value' }]),
			),
		).toThrow('lattice invariant: removal path symbol is mismatched')
		expect(() =>
			removeLeaf(
				contents,
				leaf('missing', [{ symbol: firstSymbol, value: 'missing' }]),
			),
		).toThrow('lattice invariant: removal path is missing')
		expect(() =>
			removeLeaf(
				contents,
				leaf('imposter', [{ symbol: firstSymbol, value: 'value' }]),
			),
		).toThrow('lattice invariant: removal identity is mismatched')
	})

	it('uses native Map equality for NaN and signed zero', () => {
		const contents = new Map<symbol, Leaf | Step>()
		const nan = leaf('nan', [{ symbol: firstSymbol, value: Number.NaN }])
		const zero = leaf('zero', [{ symbol: firstSymbol, value: 0 }])
		insertLeaf(contents, nan)
		insertLeaf(contents, zero)

		const root = contents.get(rootSymbol)
		expect(findLeaf(resolver(new Map([[firstSymbol, Number.NaN]])), root)).toBe(
			nan,
		)
		expect(findLeaf(resolver(new Map([[firstSymbol, -0]])), root)).toBe(zero)
		expect(() =>
			insertLeaf(
				contents,
				leaf('negative zero', [{ symbol: firstSymbol, value: -0 }]),
			),
		).toThrow('lattice invariant: leaf prefix collision')
	})
})
