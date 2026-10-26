import { mountApp } from './js/ui.js';
import { GOOGLE_CONFIG } from './config.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

mountApp(GOOGLE_CONFIG);
