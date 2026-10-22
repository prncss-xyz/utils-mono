import { expect, test } from 'vitest'

import { formatTime } from './formatTime'

test.each([
	{ time: 0, expected: '00:00:00' },
	{ time: 1, expected: '00:00:01' },
	{ time: 999, expected: '00:00:01' },
	{ time: 1_000, expected: '00:00:01' },
	{ time: 1_001, expected: '00:00:02' },
	{ time: 59_000, expected: '00:00:59' },
	{ time: 59_001, expected: '00:01:00' },
	{ time: 60_000, expected: '00:01:00' },
	{ time: 3_599_000, expected: '00:59:59' },
	{ time: 3_599_001, expected: '01:00:00' },
	{ time: 3_600_000, expected: '01:00:00' },
	{ time: 3_723_000, expected: '01:02:03' },
	{ time: 86_400_000, expected: '24:00:00' },
	{ time: 360_000_000, expected: '100:00:00' },
])('formats $time milliseconds as $expected', ({ time, expected }) => {
	expect(formatTime(time)).toBe(expected)
})
