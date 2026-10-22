import { primitiveAtom } from '@prncss-xyz/react-utils'

export const timeAtom = primitiveAtom(Date.now, {
	onMount: (_get, set) => {
		set(timeAtom, Date.now())
		const interval = setInterval(() => set(timeAtom, Date.now()), 200)
		return () => clearInterval(interval)
	},
})
