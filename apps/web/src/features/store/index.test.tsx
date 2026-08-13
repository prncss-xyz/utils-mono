// oxlint-disable react/button-has-type
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'vite-plus/test'
import { page } from 'vitest/browser'

import { primitive } from './primitive'
import { useAtom } from './react'
import { AtomProvider } from './storeCtx'

const sampleValue = primitive(0)
const hashValue = primitive((hash: string) => hash.length)

function SimpleAtom() {
	const [value, setValue] = useAtom(sampleValue, undefined)
	return <button onClick={() => setValue((current) => current + 1)}>{value}</button>
}

function AtomFamily({ hash }: { hash: string }) {
	const [value, setValue] = useAtom(hashValue, hash)
	return (
		<button aria-label={hash} onClick={() => setValue((current) => current + 1)}>
			{value}
		</button>
	)
}

let root: Root | undefined

async function render(children: ReactNode) {
	const container = document.createElement('main')
	document.body.append(container)
	root = createRoot(container)
	await act(async () => {
		root?.render(<AtomProvider>{children}</AtomProvider>)
	})
}

afterEach(async () => {
	await act(async () => root?.unmount())
	document.body.replaceChildren()
	root = undefined
})

describe('atoms', () => {
	test('updates a primitive atom', async () => {
		await render(<SimpleAtom />)
		const button = page.getByRole('button')

		await expect.element(button).toHaveTextContent('0')
		await button.click()
		await expect.element(button).toHaveTextContent('1')
	})

	test('shares state between atoms with the same hash', async () => {
		await render(
			<>
				<AtomFamily hash='same' />
				<AtomFamily hash='same' />
			</>,
		)
		const buttons = page.getByRole('button', { name: 'same' })

		await expect.element(buttons.nth(0)).toHaveTextContent('4')
		await expect.element(buttons.nth(1)).toHaveTextContent('4')
		await buttons.nth(0).click()
		await expect.element(buttons.nth(0)).toHaveTextContent('5')
		await expect.element(buttons.nth(1)).toHaveTextContent('5')
	})

	test('keeps atoms with different hashes independent', async () => {
		await render(
			<>
				<AtomFamily hash='short' />
				<AtomFamily hash='much-longer' />
			</>,
		)
		const short = page.getByRole('button', { name: 'short' })
		const muchLonger = page.getByRole('button', { name: 'much-longer' })

		await short.click()
		await expect.element(short).toHaveTextContent('6')
		await expect.element(muchLonger).toHaveTextContent('11')
	})
})
