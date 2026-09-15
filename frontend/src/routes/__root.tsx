import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundRoute,
})

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function NotFoundRoute() {
  const t = useT()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
        {t('shell.notFound.code')}
      </div>
      <p className="text-sm text-foreground">{t('shell.notFound.title')}</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">{t('shell.notFound.back')}</Link>
      </Button>
    </div>
  )
}
