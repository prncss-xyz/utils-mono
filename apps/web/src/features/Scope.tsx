'use client'

import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ScopeLike } from '@prncss-xyz/react-utils'
import {
	derivedScope,
	primitiveScope,
	RootScope,
	useScope,
} from '@prncss-xyz/react-utils'

const logLifecycle = (name: string) => (value: string) => {
	// oxlint-disable-next-line no-console
	console.log(`[scope] mount ${name}:`, value)
	return () => {
		// oxlint-disable-next-line no-console
		console.log(`[scope] unmount ${name}:`, value)
	}
}

const PlaceScope = primitiveScope<string>(logLifecycle('place'))
const ColorScope = primitiveScope<string>(logLifecycle('color'))

const descriptionScope = derivedScope(
	(read) => `${read(ColorScope)} in the ${read(PlaceScope)} scope`,
	logLifecycle('description (derived)'),
)

function ScopeValue({
	label,
	scope,
}: {
	label: string
	scope: ScopeLike<string>
}) {
	const value = useScope(scope)

	return (
		<Text>
			{label}: {value}
		</Text>
	)
}

export function ScopeDemo() {
	return (
		<RootScope>
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
		</RootScope>
	)
}
