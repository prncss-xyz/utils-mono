'use client'
import { Button, HStack, VStack } from '@astryxdesign/core'

import { RESET } from '../store/functions'
import { useAtom } from './react'
import { derived, primitive } from './store'

const simple = primitive(0)

function Simple() {
	const [value, setValue] = useAtom(simple)
	return (
		<HStack gap={3}>
			{value}
			<Button label='3' onClick={() => setValue(3)} />
			<Button label='inc' onClick={() => setValue((x) => x + 1)} />
			<Button label='reset' onClick={() => setValue(RESET)} />
		</HStack>
	)
}

const double = derived(
	(read) => read(simple) * 2,
	(read, write, e: number) => write(simple, read(simple) + e),
)

function Double() {
	const [value, setValue] = useAtom(double)
	return (
		<HStack gap={3}>
			{value}
			<Button label='inc' onClick={() => setValue(3)} />
		</HStack>
	)
}

export function Demo() {
	return (
		<VStack gap={5}>
			<Simple />
			<Double />
		</VStack>
	)
}
