'use client'
import { Button, HStack, VStack } from '@astryxdesign/core'
import {
	RESET,
	StoreProvider,
	derived,
	useAtom,
	family,
	primitive,
} from '@prncss-xyz/react-utils'

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
	(_read, write, e: number) => write(simple, Math.floor(e / 2)),
)

function Double() {
	const [value, setValue] = useAtom(double)
	return (
		<HStack gap={3}>
			{value}
			<Button label='16' onClick={() => setValue(16)} />
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

export function StoreDemo() {
	return (
		<StoreProvider hydrate={[[double, 4]]}>
			<Demo0 />
		</StoreProvider>
	)
}
