import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

type RouterLinkProps = Omit<ComponentProps<typeof Link>, 'to'> & {
	href: ComponentProps<typeof Link>['to']
}

/** Adapt Astryx's href-based link contract to TanStack Router navigation. */
export function RouterLink({ href, ...props }: RouterLinkProps) {
	return <Link to={href} {...props} />
}
