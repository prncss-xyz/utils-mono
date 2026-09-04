import { AppShell } from '@astryxdesign/core/AppShell'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'

import { ScopeDemo } from '@/features/Scope'

export default async function Page() {
	return (
		<AppShell contentPadding={0} height='auto' variant='wash'>
			<VStack gap={0}>
				<Section variant='transparent' padding={10}>
					<VStack gap={3}>
						<Heading level={1} type='display-1' textWrap='balance'>
							Scope
						</Heading>
						<Text color='secondary'>
							Two direct scopes, one nested override, and one derived scope.
							Open the browser console to see every mount and unmount.
						</Text>
					</VStack>
				</Section>

				<Section variant='section' padding={10} dividers={['top']}>
					<ScopeDemo />
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
