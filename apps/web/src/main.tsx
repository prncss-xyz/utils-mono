import {
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'

import DialogPage from './pages/Dialog'
import HomePage from './pages/Home'
import { Layout } from './pages/Layout'
import MultistepsPage from './pages/Multisteps/index'
import ScopePage from './pages/Scope'
import StorePage from './pages/Store'
import TimerPage from './pages/Timer/index'

import './styles.css'

const rootRoute = createRootRoute({ component: Layout })
const routeTree = rootRoute.addChildren([
	createRoute({
		getParentRoute: () => rootRoute,
		path: '/',
		component: HomePage,
	}),
	createRoute({
		getParentRoute: () => rootRoute,
		path: '/dialog',
		component: DialogPage,
	}),
	createRoute({
		getParentRoute: () => rootRoute,
		path: '/multisteps',
		component: MultistepsPage,
	}),
	createRoute({
		getParentRoute: () => rootRoute,
		path: '/scope',
		component: ScopePage,
	}),
	createRoute({
		getParentRoute: () => rootRoute,
		path: '/store',
		component: StorePage,
	}),
	createRoute({
		getParentRoute: () => rootRoute,
		path: '/timer',
		component: TimerPage,
	}),
])

const router = createRouter({ routeTree, basepath: import.meta.env.BASE_URL })

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

createRoot(document.getElementById('root')!).render(
	<RouterProvider router={router} />,
)
