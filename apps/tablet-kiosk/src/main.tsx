import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initI18n } from '@ilt/ui';
import { App } from './App';

void initI18n().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
