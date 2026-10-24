import { useState } from 'react'
import { expect } from 'storybook/test'

import preview from '../../.storybook/preview'
import { StoreProvider, useAtom, useAtomValue, useSetAtom } from './react'
import { atomFamily, derivedAtom, primitiveAtom } from './store'

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
