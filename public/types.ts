import { NavigationPublicPluginStart } from '../../../src/plugins/navigation/public';

export interface MetadataPluginPluginSetup {
  getGreeting: () => string;
}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MetadataPluginPluginStart {}

export interface AppPluginStartDependencies {
  navigation: NavigationPublicPluginStart;
}
