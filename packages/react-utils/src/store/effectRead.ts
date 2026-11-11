import type { Read } from './atoms'

const untrackedReads = new WeakMap<Read, Read>()

export function associateUntrackedRead(read: Read, untrackedRead: Read) {
	untrackedReads.set(read, untrackedRead)
}

export function untrackedRead(read: Read): Read {
	return untrackedReads.get(read) ?? read
}
