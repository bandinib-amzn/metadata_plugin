/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '../../../src/core/server';
import { MetadataPluginSetup, MetadataPluginStart } from './types';
import { defineRoutes } from './routes';
import { PostgresClientWrapper } from './saved_object_wrapper';

export class MetadataPlugin implements Plugin<MetadataPluginSetup, MetadataPluginStart> {
  private readonly logger: Logger;
  private savedObjectClientWrapper: PostgresClientWrapper;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
    this.savedObjectClientWrapper = new PostgresClientWrapper();
  }

  public setup(core: CoreSetup) {
    this.logger.info('metadata-plugin: Setup');


    const router = core.http.createRouter();

    // Register server side APIs
    defineRoutes(router);

    // ToDo: Add condition to check If metadata enabled
    core.savedObjects.addClientWrapper(
      0,
      'postgres-saved-object-client-wrapper',
      this.savedObjectClientWrapper.wrapperFactory
    );

    return {};
  }

  public start(core: CoreStart) {
    this.logger.info('metadata-plugin: Started');

    this.savedObjectClientWrapper.typeRegistry = core.savedObjects.getTypeRegistry();
    console.log(`this.savedObjectClientWrapper.typeRegistry : ${this.savedObjectClientWrapper.typeRegistry}`);
    this.savedObjectClientWrapper.setup();
    return {};
  }

  public stop() {}
}
