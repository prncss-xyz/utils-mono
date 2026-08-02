import { For } from '.'
import preview from '../../../.storybook/preview'

const meta = preview.meta({
	title: 'Components/For',
	component: For<string>,
	tags: ['autodocs'],
})

export default meta

export const WithItems = meta.story({
	args: {
		each: ['apple', 'banana', 'cherry'],
		getKey: (item: string) => item,
		render: (item: string) => <li>{item}</li>,
	},
	render: (args) => (
		<ul>
			<For {...args} />
		</ul>
	),
})

export const EmptyWithFallback = meta.story({
	args: {
		each: [],
		fallback: <li>No items to display.</li>,
		getKey: (item: string) => item,
		render: (item: string) => <li>{item}</li>,
	},
	render: (args) => (
		<ul>
			<For {...args} />
		</ul>
	),
})

export const EmptyWithoutFallback = meta.story({
	args: {
		each: [],
		getKey: (item: string) => item,
		render: (item: string) => <li>{item}</li>,
	},
	render: (args) => (
		<ul>
			<For {...args} />
		</ul>
	),
})
