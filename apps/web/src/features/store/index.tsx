'use client'

import { Button, Card, HStack, Text, VStack } from '@astryxdesign/core'

import { primitive } from './primitive'
import { useAtom, useAtomValue } from './react'
import { scope } from './scope'
import { AtomProvider } from './storeCtx'

const sampleValue = primitive(0)
const hashValue = primitive((hash: string) => hash.length)
const LabelScope = scope<string>()

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
	const label = useAtomValue(LabelScope, undefined)
	return <Text>{label}</Text>
}

export function ScopeExample() {
	return (
		<Card>
			<VStack gap={3}>
				<LabelScope value='outer scope'>
					<ScopedValue />
					<LabelScope value='nested scope'>
						<ScopedValue />
					</LabelScope>
				</LabelScope>
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
