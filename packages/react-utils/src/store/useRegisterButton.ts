import type { Sendable } from '../tags'
import type { MachineAtom } from './coreMachineAtom'
import { useAtomValue, useSetAtom } from './react'

export function useRegisterButton<E>(
	machine: MachineAtom<E, any>,
	event: Sendable<E>,
) {
	const disabled = !useAtomValue(machine.can, event)
	const send = useSetAtom(machine)

	return {
		disabled,
		onClick: () => send(event),
	}
}
