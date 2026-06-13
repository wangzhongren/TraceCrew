import ReactDOM from 'react-dom/client';
import App from './App';
import { LocaleProvider } from './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <LocaleProvider>
    <App />
  </LocaleProvider>
);
