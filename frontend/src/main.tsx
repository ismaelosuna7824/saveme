import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider } from '@tanstack/react-router'

import { UiProvider } from '@/app/preferences'
import { I18nGate } from '@/i18n/I18nGate'
import { BootGate } from '@/components/boot/BootGate'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { router } from '@/router'

import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

const container = document.getElementById('root')
if (container === null) {
  throw new Error('index.html no tiene un elemento #root')
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UiProvider>
        <TooltipProvider delayDuration={350}>
          <I18nGate>
            <BootGate>
              <RouterProvider router={router} />
            </BootGate>
          </I18nGate>
          <Toaster />
        </TooltipProvider>
      </UiProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  </StrictMode>,
)
