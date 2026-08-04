import babel from '@rolldown/plugin-babel'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

const basepath = (process.env.VITE_BASE_PATH ?? '') + '/'

const config = defineConfig({
	base: basepath,
	optimizeDeps: {
		exclude: ['@astryxdesign/core'],
	},
	resolve: { tsconfigPaths: true },
	plugins: [viteReact(), babel({ presets: [reactCompilerPreset()] })],
	run: {
		tasks: {
			'vp:tsc': 'tsc --noEmit',
		},
	},
})

export default config
