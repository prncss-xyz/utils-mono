'use client'

import type { ComponentProps } from 'react'
import { Link as WakuLink } from 'waku/router/client'

type WakuLinkProps = ComponentProps<typeof WakuLink>

type RouterLinkProps = Omit<WakuLinkProps, 'to'> & { href: string }

/**
 * Bridge between the astryx Link `as` contract (href) and the Waku router
 * Link (`to`). Pass as `as` on an astryx Link to get styled formatting with
 * Waku client-side navigation:
 *
 *   <Link as={RouterLink} href='/demo'>Demo</Link>
 */
export function RouterLink({ href, ...props }: RouterLinkProps) {
	return <WakuLink to={href as WakuLinkProps['to']} {...props} />
}
