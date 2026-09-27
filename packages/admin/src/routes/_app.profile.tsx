import { createFileRoute } from '@tanstack/react-router'

import { ConnectedApps } from '@/features/oauth/ConnectedApps'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { TokensSection } from '@/features/tokens/TokensSection'

export const Route = createFileRoute('/_app/profile')({
  component: () => (
    <ProfilePage
      extra={
        <>
          <TokensSection />
          <ConnectedApps />
        </>
      }
    />
  ),
})
