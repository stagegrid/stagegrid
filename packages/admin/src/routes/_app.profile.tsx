import { createFileRoute } from '@tanstack/react-router'

import { ProfilePage } from '@/features/profile/ProfilePage'
import { TokensSection } from '@/features/tokens/TokensSection'

export const Route = createFileRoute('/_app/profile')({
  component: () => <ProfilePage extra={<TokensSection />} />,
})
