import { defineConfig } from 'waku/config'

import vite from './vite.config'

export default defineConfig({
	basePath: (process.env.VITE_BASE_PATH ?? '') + '/',
	vite: vite as any,
})
