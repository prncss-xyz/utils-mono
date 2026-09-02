// source: https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts
function hasObjectPrototype(o: any): boolean {
	return Object.prototype.toString.call(o) === '[object Object]'
}

function isPlainObject(o: any): o is Record<PropertyKey, unknown> {
	if (!hasObjectPrototype(o)) {
		return false
	}

	// If has no constructor
	const ctor = o.constructor
	if (ctor === undefined) {
		return true
	}

	// If has modified prototype
	const prot = ctor.prototype
	if (!hasObjectPrototype(prot)) {
		return false
	}

	// If constructor does not have an Object-specific method
	// eslint-disable-next-line no-prototype-builtins
	if (!prot.hasOwnProperty('isPrototypeOf')) {
		return false
	}

	// Handles Objects created by Object.create(<arbitrary prototype>)
	if (Object.getPrototypeOf(o) !== Object.prototype) {
		return false
	}

	// Most likely a plain Object
	return true
}

export function getHash(queryKey: unknown): string {
	return JSON.stringify(queryKey, (_, val) =>
		isPlainObject(val)
			? Object.keys(val)
					.sort()
					.reduce((result, key) => {
						result[key] = val[key]
						return result
					}, {} as any)
			: val,
	)
}
