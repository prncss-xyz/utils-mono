import { AppShell } from '@astryxdesign/core/AppShell'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { VStack } from '@astryxdesign/core/VStack'

import { Dialog } from '@/features/Dialog'

export default async function HomePage() {
	return (
		<AppShell contentPadding={0} height='auto' variant='wash'>
			<VStack gap={0}>
				<Section variant='transparent' padding={10}>
					<Heading level={1} type='display-1' textWrap='balance'>
						Dialog
					</Heading>
				</Section>

				<Section variant='section' padding={10} dividers={['top']}>
					<Dialog />
				</Section>
			</VStack>
		</AppShell>
	)
}

export async function getConfig() {
	return {
		render: 'static',
	} as const
}
