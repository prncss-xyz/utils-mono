'use client'

import { createPocket } from '@icydotdev/pocket'
import { type ReactNode, createElement, useState } from 'react'

const [Ctx0, useCtx0] = createPocket(() => useState<ReactNode>(undefined))

function CtxProvider0({ children }: { children: ReactNode }) {
	const [node] = useCtx0()
	return (
		<>
			{children}
			{node && <DialogProvider>{node}</DialogProvider>}
		</>
	)
}

export function DialogProvider({ children }: { children: ReactNode }) {
	return (
		<Ctx0>
			<CtxProvider0>{children}</CtxProvider0>
		</Ctx0>
	)
}

export function useDialog() {
	const [, setNode] = useCtx0()
	function call(create: (close: () => void) => ReactNode) {
		setNode(create(() => setNode(undefined)))
	}
	return call
}

export function useDialog2() {
	const [, setNode] = useCtx0()
	function call<Props extends { close: () => void }>(
		Comp: (props: Props) => ReactNode,
		props: Omit<Props, 'close'>,
	) {
		setNode(
			createElement(Comp, {
				...props,
				close: () => setNode(undefined),
			} as Props),
		)
	}
	return call
}
