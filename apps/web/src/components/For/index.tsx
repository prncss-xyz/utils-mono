import { Fragment, type ReactNode } from 'react'

export function For<Item>({
	each,
	fallback,
	getKey,
	render,
}: {
	each: Item[]
	fallback?: ReactNode
	getKey: (item: Item, index: number, ts: Item[]) => string
	render: (item: Item, index: number, ts: Item[]) => ReactNode
}) {
	if (each.length) {
		return each.map((item, index, items) => (
			<Fragment key={getKey(item, index, items)}>
				{render(item, index, items)}
			</Fragment>
		))
	}
	return fallback
}
