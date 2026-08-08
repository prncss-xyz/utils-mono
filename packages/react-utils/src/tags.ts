export type Prettify<T> = unknown & {
	[K in keyof T]: T[K]
}

export type ValueUnion<T> = Prettify<T[keyof T]>
export const TYPE = 'type'
export type Type = typeof TYPE
export const PAYLOAD = 'payload'
export type Payload = typeof PAYLOAD

export type Tag<Type extends PropertyKey, Payload> = Prettify<{
	[PAYLOAD]: Payload
	[TYPE]: Type
}>

export type AnyTag = Tag<any, any>
export type TypeIn<T extends AnyTag> = T[Type]
export type TagOf<T extends AnyTag, Type extends TypeIn<T>> = Prettify<
	T & {
		[TYPE]: Type
	}
>

export type Tags<O> = ValueUnion<{ [K in keyof O]: Tag<K, O[K]> }>

export function tag<Type extends PropertyKey>(type: Type): Tag<Type, void>
export function tag<Type extends PropertyKey, Payload>(
	type: Type,
	payload: Payload,
): Tag<Type, Payload>
export function tag(p1: any, p2?: any) {
	return { payload: p2, type: p1 }
}
