import '@backstage/cli/asset-types';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@backstage/ui/css/styles.css';
// The two AI Assistants chat paths each vendor + import their own scoped
// stylesheet inside their lazy page chunk (react-ui CSS for the collapsible
// path, Impl2's Tailwind build for the native path), so nothing is imported
// globally here — that keeps their `.aui-root` rules from colliding.

ReactDOM.createRoot(document.getElementById('root')!).render(App.createRoot());
