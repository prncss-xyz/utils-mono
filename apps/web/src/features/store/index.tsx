'use client'

import { Button, Text, VStack } from '@astryxdesign/core'

import { primitive, Store } from './primitive'
import { useAtom } from './react'
import { StoreCtx } from './storeCtx'

const sampleValue = primitive(0)

export function Store0() {
	const [sample, setSample] = useAtom(sampleValue)
	return (
		<VStack gap={3}>
			<Text>{sample}</Text>
			<Button label='inc' onClick={() => setSample((x) => x + 1)} />
		</VStack>
	)
}

const value = new Store()

export function Demo() {
	return (
		<StoreCtx value={value}>
			<Store0 />
		</StoreCtx>
	)
}
