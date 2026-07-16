import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/api/queryClient';
import { IntroOverlay } from '@/components/common/IntroOverlay';
import { router } from './router';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <IntroOverlay />
      <RouterProvider router={router} />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
