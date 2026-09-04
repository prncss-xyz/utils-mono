import { AppShell } from '@astryxdesign/core/AppShell'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { Section } from '@astryxdesign/core/Section'
import { VStack } from '@astryxdesign/core/VStack'

import { RouterLink } from '@/components/RouterLink'

export default async function Page() {
	return (
		<AppShell contentPadding={0} height='auto' variant='wash'>
			<VStack gap={0}>
				<Section variant='transparent' padding={10}>
					<Heading level={1} type='display-1' textWrap='balance'>
						Personal Playground
					</Heading>
				</Section>
				<Section variant='section' padding={10} dividers={['top']}>
					<VStack>
						<Link as={RouterLink} href='/store' isStandalone>
							Store
						</Link>
						<Link as={RouterLink} href='/dialog' isStandalone>
							Dialog
						</Link>
						<Link as={RouterLink} href='/multisteps' isStandalone>
							Multisteps
						</Link>
						<Link as={RouterLink} href='/scope' isStandalone>
							Scope
						</Link>
					</VStack>
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
