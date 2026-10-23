import { createCommands } from '@prncss-xyz/react-utils'
import type { ReactNode } from 'react'

export type Dependencies = {
	toast: (message: ReactNode) => void
}

export const { dependencyAtom, cmd } = createCommands<Dependencies>()
