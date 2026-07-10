import { render } from 'solid-js/web'
import { RouterProvider } from '@tanstack/solid-router'
import { QueryClientProvider } from '@tanstack/solid-query'
import { QueryClient } from '@tanstack/solid-query'
import { getRouter } from './router'
import { mountToastContainer } from './lib/toast'
import './styles.css'

const queryClient = new QueryClient()

const router = getRouter()

// Mount toast container immediately so showToast() works from any page
mountToastContainer()

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  ),
  document.getElementById('app')!
)
