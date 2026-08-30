'use client'
import { Button, HStack, VStack } from '@astryxdesign/core'
import { useState } from 'react'

import { RESET } from '../store/functions'
import { Override, useAtom, useAtomValue } from './react'
import { derived, primitive } from './store'

const simple = primitive(0)
const scoped = primitive(0)

function Simple() {
  const [value, setValue] = useAtom(simple)
  return (
    <HStack gap={3}>
      {value}
      <Button label='3' onClick={() => setValue(3)} />
      <Button label='inc' onClick={() => setValue((x) => x + 1)} />
      <Button label='reset' onClick={() => setValue(RESET)} />
    </HStack>
  )
}

function Scoped() {
  const value = useAtomValue(scoped)
  return <div>scoped:{value}</div>
}

function ScopedDemo() {
  const [value, setValue] = useState(0)
  return (
    <HStack gap={3}>
      <Button label='inc' onClick={() => setValue((x) => x + 1)} />
      <Scoped />
      <Override target={scoped} value={value}>
        <Scoped />
      </Override>
    </HStack>
  )
}

const double = derived(
  (read) => read(simple) * 2,
  (read, write, e: number) => write(simple, read(simple) + e),
)

function Double() {
  const [value, setValue] = useAtom(double)
  return (
    <HStack gap={3}>
      {value}
      <Button label='inc' onClick={() => setValue(3)} />
    </HStack>
  )
}

export function Demo() {
  return (
    <VStack gap={5}>
      <Simple />
      <Double />
      <ScopedDemo />
    </VStack>
  )
}
