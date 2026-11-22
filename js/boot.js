// Entry point: run the optional family-password gate, then mount the app.
import { mountApp, runGate } from './app.js';

function start() {
  const root = document.getElementById('root');
  root.innerHTML = '';
  mountApp(root);
}

runGate(start);
