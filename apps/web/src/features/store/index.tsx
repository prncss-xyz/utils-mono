'use client'

import { Button, Card, HStack, Text, VStack } from '@astryxdesign/core'

import { primitive } from './primitive'
import { useAtom } from './react'
import { AtomProvider } from './storeCtx'

const sampleValue = primitive(0)
const hashValue = primitive((hash: string) => hash.length)

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

export function Demo() {
	return (
		<AtomProvider>
			<VStack gap={5}>
				<SimpleAtom />
				<AtomFamily hash='caca' />
				<AtomFamily hash='caca' />
				<AtomFamily hash='pipi' />
				<AtomFamily hash='crotte' />
			</VStack>
		</AtomProvider>
	)
}
