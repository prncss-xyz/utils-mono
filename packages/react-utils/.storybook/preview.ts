import addonA11y from '@storybook/addon-a11y'
import addonDocs from '@storybook/addon-docs'
import { definePreview } from '@storybook/react-vite'

export default definePreview({
	tags: ['autodocs'],
	addons: [addonA11y(), addonDocs()],
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
