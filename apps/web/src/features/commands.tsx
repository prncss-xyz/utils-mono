import { createCommands } from '@prncss-xyz/react-utils'
import type { ReactNode } from 'react'

type DialogArgs = [
	component: (props: any) => ReactNode,
	props: Record<string, unknown>,
	onClose?: (payload: any) => void,
]

export type Dependencies = {
	toast: (message: ReactNode) => void
	dialog: (args: DialogArgs) => void
}

export const { dependencyAtom, cmd } = createCommands<Dependencies>()
