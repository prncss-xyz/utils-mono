import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'

import DialogPage from './pages/dialog'
import HomePage from './pages/index'
import MultistepsPage from './pages/multisteps'
import ScopePage from './pages/scope'
import StorePage from './pages/store'
import TimerPage from './pages/timer'

import './styles.css'

const rootRoute = createRootRoute({ component: Outlet })
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
