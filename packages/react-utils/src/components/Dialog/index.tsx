'use client'

import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	createContext,
	createElement,
	useContext,
	useEffect,
	useState,
} from 'react'

import { noop } from '../../functions'

type SetState<S> = [S, Dispatch<SetStateAction<S>>]

type DialogState = { node: ReactNode; onClose: () => void }

const Ctx0 = createContext<SetState<DialogState>>([
	{ node: undefined, onClose: noop },
	noop,
])

function CtxProvider0({ children }: { children: ReactNode }) {
	const [{ node, onClose }] = useContext(Ctx0)
	useEffect(() => {
		if (node === undefined) onClose()
	}, [node, onClose])
	return (
		<>
			{children}
			{node && <DialogProvider>{node}</DialogProvider>}
		</>
	)
}

export function DialogProvider({ children }: { children: ReactNode }) {
	return (
		<Ctx0 value={useState<DialogState>({ node: undefined, onClose: noop })}>
			<CtxProvider0>{children}</CtxProvider0>
		</Ctx0>
	)
}

export function useDialog() {
	const [, setDialog] = useContext(Ctx0)
	function call<Props extends { close: (payload: never) => void }>(
		Comp: (props: Props) => ReactNode,
		...[props, onClose = noop]: undefined extends Parameters<Props['close']>[0]
			? {} extends Omit<Props, 'close'>
				? [
						props?: Omit<Props, 'close'>,
						onClose?: (payload: Parameters<Props['close']>[0]) => void,
					]
				: [
						props: Omit<Props, 'close'>,
						onClose?: (payload: Parameters<Props['close']>[0]) => void,
					]
			: [
					props: {} extends Omit<Props, 'close'>
						? Omit<Props, 'close'> | undefined
						: Omit<Props, 'close'>,
					onClose: (payload: Parameters<Props['close']>[0]) => void,
				]
	) {
		const close = (payload: Parameters<Props['close']>[0]) =>
			setDialog({ node: undefined, onClose: () => onClose(payload) })
		setDialog({
			node: createElement(Comp, { ...props, close } as Props),
			onClose: noop,
		})
	}
	return call
}
