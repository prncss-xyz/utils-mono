export type Teardown = (() => void) | void
export type OnMount = () => Teardown

export function composeMount(a?: OnMount, b?: OnMount) {
	if (!a) return b
	if (!b) return a
	return () => {
		const teardownA = a()
		const teardownB = b()
		return () => {
			teardownB?.()
			teardownA?.()
		}
	}
}
