'use client'

import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { derivedScope, primaryScope, useScope } from '@prncss-xyz/react-utils'
import { useEffect } from 'react'

const logLifecycle = (name: string) => (value: string) => {
	// oxlint-disable-next-line no-console
	console.log(`[scope] mount ${name}:`, value)
	return () => {
		// oxlint-disable-next-line no-console
		console.log(`[scope] unmount ${name}:`, value)
	}
}

const PlaceScope = primaryScope<string>(logLifecycle('place'))
const ColorScope = primaryScope<string>(logLifecycle('color'))

const descriptionScope = derivedScope(
	(read) => `${read(ColorScope)} in the ${read(PlaceScope)} scope`,
	logLifecycle('description (derived)'),
)

function ScopeValue({
	label,
	scope,
}: {
	label: string
	scope: typeof PlaceScope | typeof descriptionScope
}) {
	const value = useScope(scope)

	useEffect(() => {
		// oxlint-disable-next-line no-console
		console.log(`[component] mount ${label}:`, value)
		return () => {
			// oxlint-disable-next-line no-console
			console.log(`[component] unmount ${label}:`, value)
		}
	}, [label, value])

	return (
		<Text>
			{label}: {value}
		</Text>
	)
}

export function ScopeDemo() {
	return (
		<PlaceScope value='outer'>
			<ColorScope value='blue'>
				<VStack gap={6}>
					<Card padding={6} variant='muted'>
						<VStack gap={3}>
							<Heading level={2}>Outer scope</Heading>
							<ScopeValue label='Place' scope={PlaceScope} />
							<ScopeValue label='Color' scope={ColorScope} />
							<ScopeValue label='Derived' scope={descriptionScope} />
						</VStack>
					</Card>

					<PlaceScope value='inner'>
						<Card padding={6}>
							<VStack gap={3}>
								<Heading level={2}>Nested scope</Heading>
								<ScopeValue label='Place' scope={PlaceScope} />
								<ScopeValue
									label='Color inherited from outer'
									scope={ColorScope}
								/>
								<ScopeValue label='Derived' scope={descriptionScope} />
							</VStack>
						</Card>
					</PlaceScope>
				</VStack>
			</ColorScope>
		</PlaceScope>
	)
}
