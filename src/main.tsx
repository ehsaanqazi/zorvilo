import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { bootstrap } from './db/bootstrap';

// Load the local database through the Rust backend right away; the UI renders as soon as it lands.
void bootstrap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
