import { AppShell } from '@astryxdesign/core/AppShell'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { VStack } from '@astryxdesign/core/VStack'

import { Timer } from '@/features/Timer'

export default function Page() {
	return (
		<AppShell contentPadding={0} height='auto' variant='wash'>
			<Section variant='transparent' padding={10}>
				<VStack gap={4} align='start'>
					<Heading level={1} type='display-1' textWrap='balance'>
						Timer
					</Heading>
					<Timer />
				</VStack>
			</Section>
		</AppShell>
	)
}
