'use client'

import { Button, Text, VStack } from '@astryxdesign/core'

import { primitive } from './primitive'
import { useStore } from './react'

const sampleValue = primitive(0)

export function Store() {
	const [sample, setSample] = useStore(sampleValue)
	return (
		<VStack gap={3}>
			<Text>{sample}</Text>
			<Button label='inc' onClick={() => setSample((x) => x + 1)} />
		</VStack>
	)
}
