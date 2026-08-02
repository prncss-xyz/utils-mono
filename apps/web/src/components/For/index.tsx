import { Fragment, type ReactNode } from 'react'

type Props<Item> = {
	/** The items to render. */
	each: Item[]

	/** Node rendered when `each` is empty. */
	fallback?: ReactNode

	/** Returns a stable key for an item. */
	getKey: (item: Item, index: number, items: Item[]) => string

	/** Renders an item. */
	render: (item: Item, index: number, items: Item[]) => ReactNode
}

/** Renders a list of items, or a fallback when the list is empty. */
export function For<Item>({ each, fallback, getKey, render }: Props<Item>) {
	return (
		<>
			{each.length
				? each.map((item, index, items) => (
						<Fragment key={getKey(item, index, items)}>
							{render(item, index, items)}
						</Fragment>
					))
				: fallback}
		</>
	)
}
