import type { ReactNode } from 'react'

export function Show({
	when,
	fallback,
	children,
}: {
	when: boolean
	fallback?: ReactNode
	children: ReactNode
}) {
	if (when) return children
	return fallback
}
