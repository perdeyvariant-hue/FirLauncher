import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles/globals.css';

import App from './App';
import { windowCornerRadius } from './api/window';

// The shell's corners must match the window's, or blur shows past them.
void windowCornerRadius()
  .then((radius) => {
    document.documentElement.style.setProperty('--window-radius', `${String(radius)}px`);
  })
  .catch(() => undefined);

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
