'use client'

import { createPocket } from '@icydotdev/pocket'
import { useState, type ReactNode } from 'react'

const [Ctx0, useCtx0] = createPocket(() => useState<ReactNode>(undefined))

function CtxProvider0({ children }: { children: ReactNode }) {
	const [node] = useCtx0()
	return (
		<>
			{children}
			{node}
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
	const [node, call] = useCtx0()
	const pending = node !== undefined
	function close() {
		if (pending) return
		call(undefined)
	}
	return [call, close] as const
}
