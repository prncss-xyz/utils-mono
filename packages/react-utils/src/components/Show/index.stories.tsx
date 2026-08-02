import { Show } from '.'
import preview from '../../../.storybook/preview'

const meta = preview.meta({
	title: 'Components/Show',
	component: Show,
	tags: ['autodocs'],
})

export default meta

export const WhenTrue = meta.story({
	args: {
		when: true,
		children: <p>The condition is true — you can see this.</p>,
	},
})

export const WhenFalse = meta.story({
	args: {
		when: false,
		children: <p>You should not see this.</p>,
	},
})

export const WhenFalseWithFallback = meta.story({
	args: {
		when: false,
		children: <p>You should not see this.</p>,
		fallback: <p>The condition is false — showing fallback instead.</p>,
	},
})
