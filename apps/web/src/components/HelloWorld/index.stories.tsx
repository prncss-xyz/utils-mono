import preview from '@/../.storybook/preview'

import { HelloWorld } from '.'

const meta = preview.meta({
	title: 'Example/Hello World',
	component: HelloWorld,
	tags: ['autodocs'],
})

export const Default = meta.story({})
