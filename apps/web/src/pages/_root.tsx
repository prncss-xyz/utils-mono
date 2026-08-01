import type { ReactNode } from 'react'

import '../styles.css'

type RootElementProps = { children: ReactNode }

export default async function RootElement({ children }: RootElementProps) {
	return (
		<html lang='en'>
			<body>{children}</body>
		</html>
	)
}

export async function getConfig() {
	return {
		render: 'static',
	} as const
}
