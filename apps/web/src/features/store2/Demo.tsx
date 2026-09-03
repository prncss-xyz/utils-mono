'use client'
import { Button, HStack, VStack } from '@astryxdesign/core'

import { RESET } from '../store/functions'
import { StoreProvider, useAtom } from './react'
import { derived, family, primitive } from './store'

const simple = primitive(
	0,
	// oxlint-disable-next-line no-console
	(next, last) => console.log(next, last),
)

const group = family((k: number) => primitive(k), { TTL: Infinity })

function Simple() {
	const [value, setValue] = useAtom(simple)
	const [value2, setValue2] = useAtom(group, value)
	return (
		<>
			<HStack gap={3}>
				{value}
				<Button label='3' onClick={() => setValue(3)} />
				<Button label='-' onClick={() => setValue((x) => x - 1)} />
				<Button label='+' onClick={() => setValue((x) => x + 1)} />
				<Button label='reset' onClick={() => setValue(RESET)} />
			</HStack>
			<HStack gap={3}>
				{value2}
				<Button label='3' onClick={() => setValue2(3)} />
				<Button label='-' onClick={() => setValue2((x) => x - 1)} />
				<Button label='+' onClick={() => setValue2((x) => x + 1)} />
				<Button label='reset' onClick={() => setValue2(RESET)} />
			</HStack>
		</>
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
			<Button label='+' onClick={() => setValue(3)} />
		</HStack>
	)
}

function Demo0() {
	return (
		<VStack gap={5}>
			<Simple />
			<Double />
		</VStack>
	)
}

export function Demo() {
	return (
		<StoreProvider>
			<Demo0 />
		</StoreProvider>
	)
}
