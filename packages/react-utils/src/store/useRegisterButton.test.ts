import { describe, expect, it, vi } from 'vitest'

import { coreMachineAtom } from './coreMachineAtom'
import * as storeReact from './react'
import { useRegisterButton } from './useRegisterButton'

vi.mock('./react', () => ({
	useAtomValue: vi.fn(),
	useSetAtom: vi.fn(),
}))

describe('useRegisterButton', () => {
	it('returns the disabled state and click handler', () => {
		type Events = { START: void }
		const machine = coreMachineAtom<Events, 'idle' | 'running'>(
			'idle',
			(event, state) => {
				if (event.type === 'START' && state === 'idle') return 'running'
				return state
			},
		)
		const send = vi.fn()

		vi.mocked(storeReact.useSetAtom).mockReturnValue(send)
		vi.mocked(storeReact.useAtomValue).mockReturnValue(true)

		const enabledButton = useRegisterButton(machine, 'START')

		expect(storeReact.useAtomValue).toHaveBeenCalledWith(machine.can, 'START')
		expect(storeReact.useSetAtom).toHaveBeenCalledWith(machine)
		expect(enabledButton.disabled).toBe(false)

		enabledButton.onClick()
		expect(send).toHaveBeenCalledWith('START')

		vi.mocked(storeReact.useAtomValue).mockReturnValue(false)

		const disabledButton = useRegisterButton(machine, 'START')

		expect(disabledButton.disabled).toBe(true)
	})
})
