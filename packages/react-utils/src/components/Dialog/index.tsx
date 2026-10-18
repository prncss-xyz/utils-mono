'use client'

import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	createContext,
	createElement,
	useContext,
	useState,
} from 'react'

import { noop } from '../../functions'

type SetState<S> = [S, Dispatch<SetStateAction<S>>]

const Ctx0 = createContext<SetState<ReactNode>>([undefined, noop])

function CtxProvider0({ children }: { children: ReactNode }) {
	const [node] = useContext(Ctx0)
	return (
		<>
			{children}
			{node && <DialogProvider>{node}</DialogProvider>}
		</>
	)
}

export function DialogProvider({ children }: { children: ReactNode }) {
	return (
		<Ctx0 value={useState<ReactNode>(undefined)}>
			<CtxProvider0>{children}</CtxProvider0>
		</Ctx0>
	)
}

export function useDialog() {
	const [, setNode] = useContext(Ctx0)
	function call<Props extends { close: () => void }>(
		Comp: (props: Props) => ReactNode,
		props: Omit<Props, 'close'>,
	) {
		const close = () => setNode(undefined)
		setNode(createElement(Comp, { ...props, close } as Props))
	}
	return call
}
