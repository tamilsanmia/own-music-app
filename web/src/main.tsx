import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppProviders, AppRoutes, createQueryClient } from './App';
import './index.css';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders queryClient={queryClient}>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
);
