import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import signalsPlugin from '@backstage/plugin-signals/alpha';
import assistantsPlugin, {
  assistantsPanelModule,
} from '@drewswiredin/backstage-plugin-assistants/alpha';
import { clientToolsModule } from './modules/clientTools';
import { navModule } from './modules/nav';
import { signInModule } from './modules/signIn';

export default createApp({
  // signalsPlugin registers the signalApi the assistants plugin uses for
  // real-time conversation notifications (working / unread).
  features: [
    catalogPlugin,
    signalsPlugin,
    assistantsPlugin,
    // The panel: a floating button on every page.
    assistantsPanelModule,
    // Demo client tools (browser info, clipboard, a connect flow).
    clientToolsModule,
    navModule,
    signInModule,
  ],
});
