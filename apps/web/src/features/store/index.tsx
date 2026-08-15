'use client'

import { Button, Card, HStack, Text, VStack } from '@astryxdesign/core'
import { id } from '@prncss-xyz/react-utils'

import { RESET } from './functions'
import { primitive } from './primitive'
import { useAtom, useAtomValue } from './react'
import { scope } from './scope'
import { AtomProvider } from './storeCtx'

const sampleValue = primitive(0)
const hashValue = primitive(id<number>)
const LabelScope = scope<string>()

function AtomFamily({ index }: { index: number }) {
	const [value, setValue] = useAtom(hashValue, index)
	return (
		<Card>
			<HStack gap={3}>
				<Text>
					{index}:{value}
				</Text>
				<Button label='inc' onClick={() => setValue((x) => x + 1)} />
				<Button label='reset' onClick={() => setValue(RESET)} />
			</HStack>
		</Card>
	)
}

function SimpleAtom() {
	const [value, setValue] = useAtom(sampleValue, undefined)
	return (
		<Card>
			<HStack gap={3}>
				<Text>void:{value}</Text>
				<Button label='inc' onClick={() => setValue((x) => x + 1)} />
			</HStack>
		</Card>
	)
}

function ScopedValue() {
	const label = useAtomValue(LabelScope, undefined)
	return <Text>{label}</Text>
}

function ScopeExample() {
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
				<AtomFamily index={4} />
				<AtomFamily index={4} />
				<AtomFamily index={3} />
			</VStack>
		</AtomProvider>
	)
}
