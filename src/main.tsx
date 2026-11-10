import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initApp } from './lib/store';
import '@fontsource/archivo/latin-600.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';

initApp();
createRoot(document.getElementById('root')!).render(<App />);
