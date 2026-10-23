import { LayerProvider } from '@astryxdesign/core/Layer'
import { DialogProvider, StoreProvider } from '@prncss-xyz/react-utils'
import { Outlet } from '@tanstack/react-router'

export function Layout() {
	return (
		<LayerProvider>
			<StoreProvider>
				<DialogProvider>
					<Outlet />
				</DialogProvider>
			</StoreProvider>
		</LayerProvider>
	)
}
