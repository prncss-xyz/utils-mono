import { LayerProvider } from '@astryxdesign/core/Layer'
import { useToast } from '@astryxdesign/core/Toast'
import {
	DialogProvider,
	StoreProvider,
	useSetAtom,
} from '@prncss-xyz/react-utils'
import { Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'

import { dependencyAtom, type Dependencies } from './commands'

function Injector() {
	const showToast = useToast()
	const setDependencies = useSetAtom(dependencyAtom)
	useEffect(() => {
		const dependencies: Dependencies = {
			toast: (body) => showToast({ body }),
		}
		setDependencies(dependencies)
	}, [showToast, setDependencies])
	return <Outlet />
}

export function InjectorLayout() {
	return (
		<LayerProvider>
			<StoreProvider>
				<DialogProvider>
					<Injector />
				</DialogProvider>
			</StoreProvider>
		</LayerProvider>
	)
}
