'use client'

import { Button, Text, VStack } from '@astryxdesign/core'

import { primitive } from './primitive'
import { useAtom } from './react'
import { AtomProvider } from './storeCtx'

const sampleValue = primitive(0)

export function Store0() {
	const [sample, setSample] = useAtom(sampleValue, undefined)
	return (
		<VStack gap={3}>
			<Text>{sample}</Text>
			<Button label='inc' onClick={() => setSample((x) => x + 1)} />
		</VStack>
	)
}

export function Demo() {
	return (
		<AtomProvider>
			<Store0 />
		</AtomProvider>
	)
}
