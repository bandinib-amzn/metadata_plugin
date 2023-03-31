import { PluginInitializerContext } from '../../../src/core/server';
import { MetadataPluginPlugin } from './plugin';

// This exports static code and TypeScript types,
// as well as, OpenSearch Dashboards Platform `plugin()` initializer.

export function plugin(initializerContext: PluginInitializerContext) {
  return new MetadataPluginPlugin(initializerContext);
}

export { MetadataPluginPluginSetup, MetadataPluginPluginStart } from './types';
