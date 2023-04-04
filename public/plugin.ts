/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { i18n } from '@osd/i18n';
import {
  AppMountParameters,
  CoreSetup,
  CoreStart,
  Plugin,
  PluginInitializerContext,
} from '../../../src/core/public';
import { MetadataPluginSetup, MetadataPluginStart, AppPluginStartDependencies } from './types';
import { PLUGIN_NAME } from '../common';

export class MetadataPlugin implements Plugin<MetadataPluginSetup, MetadataPluginStart> {
  constructor(private readonly initializerContext: PluginInitializerContext) {
    // can retrieve config from initializerContext
  }
  public setup(core: CoreSetup): MetadataPluginSetup {
    // Register an application into the side navigation menu
    core.application.register({
      id: 'metadataPlugin',
      title: PLUGIN_NAME,
      async mount(params: AppMountParameters) {
        // Load application bundle
        const { renderApp } = await import('./application');
        // Get start services as specified in opensearch_dashboards.json
        const [coreStart, depsStart] = await core.getStartServices();
        // Render the application
        return renderApp(coreStart, depsStart as AppPluginStartDependencies, params);
      },
    });

    // Return methods that should be available to other plugins
    return {
      getGreeting() {
        return i18n.translate('metadataPlugin.greetingText', {
          defaultMessage: 'Hello from {name}!',
          values: {
            name: PLUGIN_NAME,
          },
        });
      },
    };
  }

  public start(core: CoreStart): MetadataPluginStart {
    return {};
  }

  public stop() {}
}
