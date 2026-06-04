import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import assistantsPlugin from '@drewswiredin/backstage-plugin-assistants/alpha';
import { navModule } from './modules/nav';

export default createApp({
  features: [catalogPlugin, assistantsPlugin, navModule],
});
