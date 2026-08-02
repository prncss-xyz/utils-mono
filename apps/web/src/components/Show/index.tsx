import type { ReactNode } from 'react'

/** Renders `children` when the condition is true, or a fallback otherwise. */
export function Show({
	when,
	fallback,
	children,
}: {
	/** Whether to render `children`. */
	when: boolean

	/** Node rendered when `when` is false. */
	fallback?: ReactNode

	/** Node rendered when `when` is true. */
	children: ReactNode
}) {
	if (when) return <>{children}</>
	return <>{fallback}</>
}
