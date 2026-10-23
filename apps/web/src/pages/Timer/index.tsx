import {
	Layout,
	LayoutContent,
	LayoutHeader,
	LayoutPanel,
	List,
	ListItem,
} from '@astryxdesign/core'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { useAtomValue, useSetAtom } from '@prncss-xyz/react-utils'
import { useEffect } from 'react'

import {
	activeAtom,
	activateListAtom,
	completeTimerAtom,
	fulfilledAtom,
} from './atoms'
import { allListAtom } from './atoms/list'
import { timeAtom } from './atoms/time'
import { runningAtom } from './atoms/timer'
import { ListHeading } from './ListHeading'
import { Timer } from './Timer'
import { TimerList } from './TimerList'

function TimeUpdater() {
	const setTime = useSetAtom(timeAtom)
	useEffect(() => {
		setTime(Date.now())
		const interval = setInterval(() => setTime(Date.now()), 15)
		return () => clearInterval(interval)
	}, [setTime])
	return null
}

function CompletionNotifier() {
	const fulfilled = useAtomValue(fulfilledAtom)
	const running = useAtomValue(runningAtom)
	const active = useAtomValue(activeAtom)
	const complete = useSetAtom(completeTimerAtom)
	const showToast = useToast()
	useEffect(() => {
		if (fulfilled && running) {
			complete()
			showToast({ body: 'done' })
		}
	}, [fulfilled, running, active, complete, showToast])
	return null
}

function ListSelector() {
	const { lists, active } = useAtomValue(allListAtom)
	const activate = useSetAtom(activateListAtom)
	return (
		<List header='Lists'>
			{Object.entries(lists).map(([id, { name }]) => (
				<ListItem
					key={id}
					label={name || 'Untitled list'}
					isSelected={id === active}
					onClick={() => activate(id)}
				/>
			))}
		</List>
	)
}

export default function TimerPage() {
	return (
		<>
			<TimeUpdater />
			<CompletionNotifier />
			<AppShell contentPadding={0} height='auto' variant='wash'>
				<Section variant='transparent' padding={10}>
					<Layout
						height='auto'
						padding={10}
						header={
							<LayoutHeader>
								<Heading level={1} type='display-1' textWrap='balance'>
									Timer
								</Heading>
							</LayoutHeader>
						}
						end={
							<LayoutPanel
								width={240}
								padding={4}
								hasDivider
								label='Timer lists'
							>
								<ListSelector />
							</LayoutPanel>
						}
					>
						<LayoutContent isScrollable={false}>
							<VStack gap={4} align='start'>
								<Timer />
								<ListHeading />
								<TimerList />
							</VStack>
						</LayoutContent>
					</Layout>
				</Section>
			</AppShell>
		</>
	)
}
