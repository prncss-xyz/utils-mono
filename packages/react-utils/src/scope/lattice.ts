import { isoAssert } from '../functions'

type LatticePathEntry<StepSymbol = unknown, Key = unknown> = Readonly<{
	symbol: StepSymbol
	value: Key
}>

export type LatticeLeaf<
	RootSymbol = unknown,
	PathEntry extends LatticePathEntry = LatticePathEntry,
> = Readonly<{
	symbol: RootSymbol
	scopes: readonly PathEntry[]
}>

type LeafType<Leaf> = 'type' extends keyof Leaf
	? Leaf[Extract<'type', keyof Leaf>]
	: never

type NonStepLeaf<Leaf> = 'step' extends LeafType<Leaf> ? never : Leaf

type LatticeStep<Leaf extends LatticeLeaf = LatticeLeaf> = {
	readonly type: 'step'
	readonly symbol: Leaf['scopes'][number]['symbol']
	readonly values: Map<Leaf['scopes'][number]['value'], LatticeNode<Leaf>>
}

export type LatticeNode<Leaf extends LatticeLeaf = LatticeLeaf> =
	| LatticeStep<Leaf>
	| NonStepLeaf<Leaf>

export type LatticeResolver<StepSymbol = unknown, Key = unknown> = Readonly<{
	resolveScope(symbol: StepSymbol): Key
}>

const isStep = <Leaf extends LatticeLeaf>(
	node: LatticeNode<Leaf>,
): node is LatticeStep<Leaf> =>
	(node as { readonly type?: unknown }).type === 'step'

function buildBranch<Leaf extends LatticeLeaf>(
	leaf: NonStepLeaf<Leaf>,
	depth: number,
): LatticeStep<Leaf> {
	const entry = leaf.scopes[depth]
	isoAssert(entry, 'lattice invariant: path entry is missing')
	const step: LatticeStep<Leaf> = {
		type: 'step',
		symbol: entry.symbol,
		values: new Map(),
	}
	const child =
		depth === leaf.scopes.length - 1 ? leaf : buildBranch(leaf, depth + 1)
	step.values.set(entry.value, child)
	return step
}

export function findLeaf<Leaf extends LatticeLeaf>(
	resolver: LatticeResolver<
		Leaf['scopes'][number]['symbol'],
		Leaf['scopes'][number]['value']
	>,
	root: LatticeNode<Leaf> | undefined,
): Leaf | undefined {
	let node = root
	while (node && isStep(node)) {
		const value = resolver.resolveScope(node.symbol)
		node = node.values.get(value)
	}
	return node
}

export function insertLeaf<Leaf extends LatticeLeaf>(
	contents: Map<Leaf['symbol'], LatticeNode<Leaf>>,
	leaf: NonStepLeaf<Leaf>,
): void {
	const root = contents.get(leaf.symbol)
	if (!root) {
		contents.set(
			leaf.symbol,
			leaf.scopes.length === 0 ? leaf : buildBranch(leaf, 0),
		)
		return
	}
	isoAssert(
		leaf.scopes.length > 0 && isStep(root),
		'lattice invariant: leaf prefix collision',
	)
	let step = root
	for (let depth = 0; depth < leaf.scopes.length; depth++) {
		const entry = leaf.scopes[depth]
		isoAssert(entry, 'lattice invariant: path entry is missing')
		isoAssert(
			step.symbol === entry.symbol,
			'lattice invariant: conflicting step symbol',
		)
		const child = step.values.get(entry.value)
		const isTerminal = depth === leaf.scopes.length - 1
		if (!child) {
			step.values.set(
				entry.value,
				isTerminal ? leaf : buildBranch(leaf, depth + 1),
			)
			return
		}
		isoAssert(
			!isTerminal && isStep(child),
			'lattice invariant: leaf prefix collision',
		)
		step = child
	}
	isoAssert(false, 'lattice invariant: insertion did not terminate')
}

export function removeLeaf<Leaf extends LatticeLeaf>(
	contents: Map<Leaf['symbol'], LatticeNode<Leaf>>,
	leaf: NonStepLeaf<Leaf>,
): void {
	const root = contents.get(leaf.symbol)
	isoAssert(root, 'lattice invariant: root is missing')
	if (!isStep(root)) {
		isoAssert(root === leaf, 'lattice invariant: root identity is mismatched')
		contents.delete(leaf.symbol)
		return
	}
	isoAssert(leaf.scopes.length > 0, 'lattice invariant: path is missing')
	const path: {
		step: LatticeStep<Leaf>
		key: Leaf['scopes'][number]['value']
	}[] = []
	let node: LatticeNode<Leaf> = root
	for (let depth = 0; depth < leaf.scopes.length; depth++) {
		const entry = leaf.scopes[depth]
		isoAssert(entry, 'lattice invariant: path entry is missing')
		isoAssert(
			isStep(node) && node.symbol === entry.symbol,
			'lattice invariant: removal path symbol is mismatched',
		)
		path.push({ step: node, key: entry.value })
		const child = node.values.get(entry.value)
		isoAssert(child, 'lattice invariant: removal path is missing')
		node = child
	}
	isoAssert(node === leaf, 'lattice invariant: removal identity is mismatched')
	const terminal = path.at(-1)
	isoAssert(terminal, 'lattice invariant: removal path is empty')
	terminal.step.values.delete(terminal.key)
	for (let index = path.length - 2; index >= 0; index--) {
		const parent = path[index]
		const child = path[index + 1]
		isoAssert(parent && child, 'lattice invariant: removal path is invalid')
		if (child.step.values.size > 0) break
		parent.step.values.delete(parent.key)
	}
	if (root.values.size === 0) contents.delete(leaf.symbol)
}
