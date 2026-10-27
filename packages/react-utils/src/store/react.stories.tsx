import { useState } from 'react'
import { expect } from 'storybook/test'

import preview from '../../.storybook/preview'
import { StoreProvider, useAtom, useAtomValue, useSetAtom } from './react'
import { atomFamily, derivedAtom, primitiveAtom, TRANSIENT } from './store'

const flushMicrotask = () => Promise.resolve()

const members = atomFamily(
	(_key: string | undefined) => {
		const value = primitiveAtom('0')
		return derivedAtom(
			(read) => read(value),
			(_read, write, ...args: [amount: number, multiplier?: number]) =>
				write(value, `${args[0] * (args[1] ?? 1)} (${args.length} arguments)`),
		)
	},
	{ TTL: Infinity },
)
const trace = primitiveAtom('ready')
const zero = derivedAtom(
	() => null,
	(_read, write) => write(trace, 'zero'),
)
const rest = derivedAtom(
	() => null,
	(_read, write, label: string, ...values: number[]) =>
		write(trace, `${label}: ${values.join(',')}`),
)

function SetterProbe({ hook }: { hook: 'useSetAtom' | 'useAtom' }) {
	const [key, setKey] = useState<string | undefined>(undefined)
	const cachedSend = useSetAtom(members, key)
	const [value, resolvedSend] = useAtom(members, key)
	const send = hook === 'useSetAtom' ? cachedSend : resolvedSend
	const cachedZero = useSetAtom(zero)
	const [, resolvedZero] = useAtom(zero)
	const sendZero = hook === 'useSetAtom' ? cachedZero : resolvedZero
	const cachedRest = useSetAtom(rest)
	const [, resolvedRest] = useAtom(rest)
	const sendRest = hook === 'useSetAtom' ? cachedRest : resolvedRest
	const traceValue = useAtomValue(trace)
	return (
		<>
			<output aria-label='Family value'>{value}</output>
			<output aria-label='Trace'>{traceValue}</output>
			<button type='button' onClick={() => send(2, 3)}>
				Send multiple
			</button>
			<button type='button' onClick={() => send(4)}>
				Send omitted
			</button>
			<button type='button' onClick={() => send(5, undefined)}>
				Send undefined
			</button>
			<button
				type='button'
				onClick={() => setKey(key === undefined ? 'other' : undefined)}
			>
				Switch key
			</button>
			<button type='button' onClick={() => sendZero()}>
				Send zero
			</button>
			<button type='button' onClick={() => sendRest('rest', 1, 2, 3)}>
				Send rest
			</button>
		</>
	)
}

function SetterHarness(props: { hook: 'useSetAtom' | 'useAtom' }) {
	return (
		<StoreProvider>
			<SetterProbe {...props} />
		</StoreProvider>
	)
}

const meta = preview.meta({
	title: 'Store/Setter arguments',
	component: SetterHarness,
	play: async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Send multiple' }))
		await expect(canvas.getByLabelText('Family value')).toHaveTextContent(
			'6 (2 arguments)',
		)
		await userEvent.click(canvas.getByRole('button', { name: 'Switch key' }))
		await expect(canvas.getByLabelText('Family value')).toHaveTextContent('0')
		await userEvent.click(canvas.getByRole('button', { name: 'Send omitted' }))
		await expect(canvas.getByLabelText('Family value')).toHaveTextContent(
			'4 (1 arguments)',
		)
		await userEvent.click(
			canvas.getByRole('button', { name: 'Send undefined' }),
		)
		await expect(canvas.getByLabelText('Family value')).toHaveTextContent(
			'5 (2 arguments)',
		)
		await userEvent.click(canvas.getByRole('button', { name: 'Switch key' }))
		await expect(canvas.getByLabelText('Family value')).toHaveTextContent(
			'6 (2 arguments)',
		)
		await userEvent.click(canvas.getByRole('button', { name: 'Send zero' }))
		await expect(canvas.getByLabelText('Trace')).toHaveTextContent('zero')
		await userEvent.click(canvas.getByRole('button', { name: 'Send rest' }))
		await expect(canvas.getByLabelText('Trace')).toHaveTextContent(
			'rest: 1,2,3',
		)
	},
})

export default meta

export const CachedSetter = meta.story({ args: { hook: 'useSetAtom' } })
export const ResolvedSetter = meta.story({ args: { hook: 'useAtom' } })

const providerCount = primitiveAtom(0)
const cachedSends = primitiveAtom(0)
const transientCommand = atomFamily(
	(_key: undefined) => {
		let sends = 0
		return derivedAtom(null, (_read, write) => write(cachedSends, ++sends))
	},
	{ TTL: TRANSIENT },
)

function ProviderProbe({ revision }: { revision: number }) {
	const [count, setCount] = useAtom(providerCount)
	const send = useSetAtom(transientCommand, undefined)
	const sends = useAtomValue(cachedSends)
	return (
		<>
			<output aria-label='Provider count'>{count}</output>
			<output aria-label='Cached sends'>{sends}</output>
			<output aria-label='Provider revision'>{revision}</output>
			<button type='button' onClick={() => setCount((value) => value + 1)}>
				Increment
			</button>
			<button type='button' onClick={() => send()}>
				Send cached
			</button>
		</>
	)
}

function ProviderHarness() {
	const [revision, setRevision] = useState(0)
	const [initial, setInitial] = useState(10)
	const [key, setKey] = useState(0)
	return (
		<>
			<button type='button' onClick={() => setRevision((value) => value + 1)}>
				Render provider
			</button>
			<button type='button' onClick={() => setInitial(20)}>
				Change hydration
			</button>
			<button type='button' onClick={() => setKey((value) => value + 1)}>
				Remount provider
			</button>
			<StoreProvider key={key} hydrate={[[providerCount, initial]]}>
				<ProviderProbe revision={revision} />
			</StoreProvider>
		</>
	)
}

export const ProviderLifetime = meta.story({
	render: () => <ProviderHarness />,
	play: async ({ canvas, userEvent }) => {
		await expect(canvas.getByLabelText('Provider count')).toHaveTextContent(
			'10',
		)
		await userEvent.click(canvas.getByRole('button', { name: 'Increment' }))
		await expect(canvas.getByLabelText('Provider count')).toHaveTextContent(
			'11',
		)
		await userEvent.click(canvas.getByRole('button', { name: 'Send cached' }))
		await expect(canvas.getByLabelText('Cached sends')).toHaveTextContent('1')
		await userEvent.click(
			canvas.getByRole('button', { name: 'Render provider' }),
		)
		await expect(canvas.getByLabelText('Provider revision')).toHaveTextContent(
			'1',
		)
		await expect(canvas.getByLabelText('Provider count')).toHaveTextContent(
			'11',
		)
		await userEvent.click(canvas.getByRole('button', { name: 'Send cached' }))
		await expect(canvas.getByLabelText('Cached sends')).toHaveTextContent('2')
		await userEvent.click(
			canvas.getByRole('button', { name: 'Change hydration' }),
		)
		await expect(canvas.getByLabelText('Provider count')).toHaveTextContent(
			'11',
		)
		await userEvent.click(
			canvas.getByRole('button', { name: 'Remount provider' }),
		)
		await expect(canvas.getByLabelText('Provider count')).toHaveTextContent(
			'20',
		)
		await expect(canvas.getByLabelText('Cached sends')).toHaveTextContent('0')
		await userEvent.click(canvas.getByRole('button', { name: 'Send cached' }))
		await expect(canvas.getByLabelText('Cached sends')).toHaveTextContent('1')
	},
})

const expiring = atomFamily((_key: string) => primitiveAtom('initial'))

function ExpiringWriter() {
	const [renders, setRenders] = useState(0)
	const send = useSetAtom(expiring, 'a')
	return (
		<>
			<output aria-label='Writer renders'>{renders}</output>
			<button type='button' onClick={() => setRenders((value) => value + 1)}>
				Rerender writer
			</button>
			<button type='button' onClick={() => send('first')}>
				Write first
			</button>
			<button type='button' onClick={() => send('second')}>
				Write second
			</button>
		</>
	)
}

function ExpiringReader() {
	return <output aria-label='Reader'>{useAtomValue(expiring, 'a')}</output>
}

function ExpiringHarness() {
	const [mounted, setMounted] = useState(true)
	return (
		<StoreProvider>
			<ExpiringWriter />
			<button type='button' onClick={() => setMounted((value) => !value)}>
				Toggle reader
			</button>
			{mounted && <ExpiringReader />}
		</StoreProvider>
	)
}

export const WriterAcrossEviction = meta.story({
	render: () => <ExpiringHarness />,
	play: async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Write first' }))
		await expect(canvas.getByLabelText('Reader')).toHaveTextContent('first')
		await userEvent.click(canvas.getByRole('button', { name: 'Toggle reader' }))
		await flushMicrotask()
		await userEvent.click(
			canvas.getByRole('button', { name: 'Rerender writer' }),
		)
		await expect(canvas.getByLabelText('Writer renders')).toHaveTextContent('1')
		await userEvent.click(canvas.getByRole('button', { name: 'Write second' }))
		await userEvent.click(canvas.getByRole('button', { name: 'Toggle reader' }))
		await expect(canvas.getByLabelText('Reader')).toHaveTextContent('second')
	},
})
