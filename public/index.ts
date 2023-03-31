import './index.scss';

import { MetadataPluginPlugin } from './plugin';

// This exports static code and TypeScript types,
// as well as, OpenSearch Dashboards Platform `plugin()` initializer.
export function plugin() {
  return new MetadataPluginPlugin();
}
export { MetadataPluginPluginSetup, MetadataPluginPluginStart } from './types';
