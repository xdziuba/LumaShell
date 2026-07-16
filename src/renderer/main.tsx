import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './themes/global.scss';

const container = document.getElementById('root');
if (!container) throw new Error('Brak elementu #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
