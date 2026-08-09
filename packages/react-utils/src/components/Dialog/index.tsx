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

function cannotClose() {
	throw new Error('close must be called inside a dialog')
}

type SetState<S> = [S, Dispatch<SetStateAction<S>>]
type DialogState = { node: ReactNode; close: () => void }

const Ctx0 = createContext<SetState<DialogState>>([
	{ node: undefined, close: noop },
	noop,
])

function CtxProvider0({ children }: { children: ReactNode }) {
	const [{ node }, setCtx] = useContext(Ctx0)
	const close = () => setCtx((ctx) => ({ ...ctx, node: undefined }))
	return (
		<>
			{children}
			{node && (
				<InternalDialogProvider dialogClose={close}>
					{node}
				</InternalDialogProvider>
			)}
		</>
	)
}

function InternalDialogProvider({
	children,
	dialogClose,
}: {
	children: ReactNode
	dialogClose: () => void
}) {
	return (
		<Ctx0
			value={useState<DialogState>({ node: undefined, close: dialogClose })}
		>
			<CtxProvider0>{children}</CtxProvider0>
		</Ctx0>
	)
}

export function DialogProvider({ children }: { children: ReactNode }) {
	return (
		<InternalDialogProvider dialogClose={cannotClose}>
			{children}
		</InternalDialogProvider>
	)
}

export function useCloseDialog() {
	const [{ close }] = useContext(Ctx0)
	return close
}

export function useCallDialog() {
	const [, setNode] = useContext(Ctx0)
	function call<Props extends object>(
		Comp: (props: Props) => ReactNode,
		...[props]: keyof Props extends never ? [props?: Props] : [props: Props]
	) {
		setNode((ctx) => ({
			...ctx,
			node: createElement(Comp, props),
		}))
	}
	return call
}
