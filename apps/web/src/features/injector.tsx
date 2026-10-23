import { LayerProvider } from '@astryxdesign/core/Layer'
import { useToast } from '@astryxdesign/core/Toast'
import { StoreProvider, hydrate } from '@prncss-xyz/react-utils'
import { Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { dependencyAtom, type Dependencies } from './commands'

function Injector({ children }: { children: ReactNode }) {
	const showToast = useToast()
	const dependencies: Dependencies = {
		toast: (body) => showToast({ body }),
	}
	return (
		<StoreProvider hydrate={[hydrate(dependencyAtom, dependencies)]}>
			{children}
		</StoreProvider>
	)
}

export function InjectorLayout() {
	return (
		<LayerProvider>
			<Injector>
				<Outlet />
			</Injector>
		</LayerProvider>
	)
}
