import { AppShell } from '@astryxdesign/core/AppShell'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { Section } from '@astryxdesign/core/Section'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'

import { HelloWorld } from '@/components/HelloWorld'

const nextSteps = [
	{
		title: 'Create a route',
		description:
			'Add a file in src/routes and TanStack Router will generate the route tree for you.',
	},
	{
		title: 'Build with Astryx',
		description:
			'Compose accessible, themeable components without rebuilding layout and interaction primitives.',
	},
	{
		title: 'Ship with confidence',
		description:
			'Use Vite+ to check, test, and build the application from one unified toolchain.',
	},
]

export default async function HomePage() {
	return (
		<AppShell contentPadding={0} height='auto' variant='wash'>
			<VStack gap={0}>
				<Section variant='transparent' padding={10}>
					<VStack gap={4} maxWidth={760}>
						<Text type='label' color='accent'>
							TanStack Start + Astryx
						</Text>
						<Heading level={1} type='display-1' textWrap='balance'>
							Your new application starts here.
						</Heading>
						<Text type='large' color='secondary' as='p' textWrap='pretty'>
							A modern React foundation with file-based routing, server
							functions, and an accessible design system ready to shape into
							your product.
						</Text>
					</VStack>
				</Section>

				<Section variant='section' padding={10} dividers={['top']}>
					<HelloWorld />
				</Section>

				<Section variant='section' padding={10} dividers={['top']}>
					<VStack gap={6}>
						<VStack gap={1}>
							<Heading level={2}>Start building</Heading>
							<Text type='supporting' as='p'>
								Edit src/routes/index.tsx, then make this experience your own.
							</Text>
						</VStack>

						<Grid
							gap={4}
							columns={{ minWidth: 220, repeat: 'fit' }}
							width='100%'
						>
							{nextSteps.map(({ title, description }) => (
								<Card key={title} padding={5} variant='muted'>
									<VStack gap={2}>
										<Heading level={3}>{title}</Heading>
										<Text type='supporting' as='p'>
											{description}
										</Text>
									</VStack>
								</Card>
							))}
						</Grid>
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
