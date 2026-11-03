import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppProviders, AppRoutes, createQueryClient } from '@/App';
import { db } from './mock-api';

/**
 * Render the whole app at `path`. `as` decides whether a refresh cookie exists, i.e. who is
 * already logged in when the page loads.
 */
export function renderApp(path: string, opts: { as?: 'admin' | 'listener' | null } = {}) {
  db.session = opts.as === 'admin' ? 'u-admin' : opts.as === 'listener' ? 'u-ann' : null;
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders queryClient={queryClient}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
  return { user, ...utils };
}
