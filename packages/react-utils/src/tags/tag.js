export function tag(type, payload, ...rest) {
	if (rest.length === 0) return { type, payload }
	return { type, payload: tag(payload, ...rest) }
}
