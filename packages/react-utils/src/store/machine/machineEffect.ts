import type { Read, Write } from '../atoms'

export type MachineEffect<R> = (
	next: R,
	last: R | undefined,
	get: Read,
	set: Write,
) => void | (() => void)
