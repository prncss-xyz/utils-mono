'use client'

import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import {
	derivedScope,
	primaryScope,
	ScopingProvider,
	useScope,
} from '@prncss-xyz/react-utils'
import { useContext, useEffect, type ReactNode } from 'react'

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

const DescriptionScope = derivedScope(
	(read) => `${read(ColorScope)} in the ${read(PlaceScope)} scope`,
	logLifecycle('description (derived)'),
)

type ScopeProviderProps = Readonly<{
	children: ReactNode
	scope: typeof PlaceScope
	value: string
}>

function ScopeProvider({ children, scope, value }: ScopeProviderProps) {
	const { context, store } = useContext(ScopingProvider)

	return (
		<ScopingProvider.Provider
			value={{ context: context.childScope(scope, value), store }}
		>
			{children}
		</ScopingProvider.Provider>
	)
}

type ScopeValueProps = Readonly<{
	label: string
	scope: typeof PlaceScope | typeof DescriptionScope
}>

function ScopeValue({ label, scope }: ScopeValueProps) {
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
		<ScopeProvider scope={PlaceScope} value='outer'>
			<ScopeProvider scope={ColorScope} value='blue'>
				<VStack gap={6}>
					<Card padding={6} variant='muted'>
						<VStack gap={3}>
							<Heading level={2}>Outer scope</Heading>
							<ScopeValue label='Place' scope={PlaceScope} />
							<ScopeValue label='Color' scope={ColorScope} />
							<ScopeValue label='Derived' scope={DescriptionScope} />
						</VStack>
					</Card>

					<ScopeProvider scope={PlaceScope} value='inner'>
						<Card padding={6}>
							<VStack gap={3}>
								<Heading level={2}>Nested scope</Heading>
								<ScopeValue label='Place' scope={PlaceScope} />
								<ScopeValue
									label='Color inherited from outer'
									scope={ColorScope}
								/>
								<ScopeValue label='Derived' scope={DescriptionScope} />
							</VStack>
						</Card>
					</ScopeProvider>
				</VStack>
			</ScopeProvider>
		</ScopeProvider>
	)
}
