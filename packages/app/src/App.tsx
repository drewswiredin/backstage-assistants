import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import signalsPlugin from '@backstage/plugin-signals/alpha';
import assistantsPlugin from '@drewswiredin/backstage-plugin-assistants/alpha';
import { navModule } from './modules/nav';

export default createApp({
  // signalsPlugin registers the signalApi the assistants plugin uses for
  // real-time conversation notifications (working / unread).
  features: [catalogPlugin, signalsPlugin, assistantsPlugin, navModule],
});
