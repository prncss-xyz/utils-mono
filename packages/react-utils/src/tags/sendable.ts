import type { Prettify, Tags } from './types'

export type KeysOfVoid<T> = {
	[K in keyof T]: T[K] extends void ? K : never
}[keyof T]

export type Sendable<T> = Prettify<Tags<T> | KeysOfVoid<T>>

export function fromSendable<T>(event: Sendable<T>): Tags<T> {
	return typeof event === 'string'
		? ({ payload: undefined, type: event } as unknown as Tags<T>)
		: (event as any)
}
