import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { resolveRuntimeBaseUrl } from './utils/inventory';

const routerBasename = resolveRuntimeBaseUrl(import.meta.env.BASE_URL);

createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={routerBasename}>
    <App />
  </BrowserRouter>
);
