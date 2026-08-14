'use client'

import { Button, Card, HStack, Text, VStack } from '@astryxdesign/core'

import { primitive } from './primitive'
import { useAtom, useAtomValue } from './react'
import { scope, Scope } from './scope'
import { AtomProvider } from './storeCtx'

const sampleValue = primitive(0)
const hashValue = primitive((hash: string) => hash.length)
const labelScope = scope<string>()

export function AtomFamily({ hash }: { hash: string }) {
	const [value, setValue] = useAtom(hashValue, hash)
	return (
		<Card>
			<HStack gap={3}>
				<Text>{hash}</Text>
				<Button label={String(value)} onClick={() => setValue((x) => x + 1)} />
			</HStack>
		</Card>
	)
}

export function SimpleAtom() {
	const [value, setValue] = useAtom(sampleValue, undefined)
	return (
		<Card>
			<HStack gap={3}>
				<Text>void</Text>
				<Button label={String(value)} onClick={() => setValue((x) => x + 1)} />
			</HStack>
		</Card>
	)
}

export function ScopedValue() {
	const label = useAtomValue(labelScope, undefined)
	return <Text>{label}</Text>
}

export function ScopeExample() {
	return (
		<Card>
			<VStack gap={3}>
				<Scope scope={labelScope} value='outer scope'>
					<ScopedValue />
					<Scope scope={labelScope} value='nested scope'>
						<ScopedValue />
					</Scope>
				</Scope>
			</VStack>
		</Card>
	)
}

export function Demo() {
	return (
		<AtomProvider>
			<VStack gap={5}>
				<SimpleAtom />
				<ScopeExample />
				<AtomFamily hash='caca' />
				<AtomFamily hash='caca' />
				<AtomFamily hash='pipi' />
				<AtomFamily hash='crotte' />
			</VStack>
		</AtomProvider>
	)
}
