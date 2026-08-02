import addonA11y from '@storybook/addon-a11y'
import addonDocs from '@storybook/addon-docs'
import { definePreview } from '@storybook/react-vite'
import { createElement } from 'react'

import '../src/styles.css'

export default definePreview({
  tags: ['autodocs'],
	addons: [addonA11y(), addonDocs()],
	decorators: [
		(Story, context) => {
			const theme =
				context.globals.backgrounds?.value === 'dark' ? 'dark' : 'light'

			document.documentElement.dataset.theme = theme

			return createElement(
				'div',
				{ 'data-astryx-theme': 'neutral' },
				createElement(Story),
			)
		},
	],
	initialGlobals: {
		backgrounds: { value: 'light' },
	},
	parameters: {
		a11y: {
			test: 'error',
		},
		backgrounds: {
			options: {
				light: { name: 'Light', value: '#ffffff' },
				dark: { name: 'Dark', value: '#171717' },
			},
		},
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
	},
})
