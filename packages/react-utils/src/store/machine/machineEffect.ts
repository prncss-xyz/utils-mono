import type { Read, Write } from '../atoms'

export type MachineEffect<R> = (
	next: R,
	last: R | undefined,
	read: Read,
	write: Write,
) => void | (() => void)
