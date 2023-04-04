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
  SavedObjectsClientFactoryProvider,
  SavedObjectsErrorHelpers,
  SavedObjectsRepositoryFactory,
} from '../../../src/core/server';
import { MetadataPluginSetup, MetadataPluginStart } from './types';
import { defineRoutes } from './routes';

export class MetadataPlugin implements Plugin<MetadataPluginSetup, MetadataPluginStart> {
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup) {
    this.logger.info('metadata-plugin: Setup');

    const clientFactoryProvider: SavedObjectsClientFactoryProvider = (
      repositoryFactory: SavedObjectsRepositoryFactory
    ) => {
      return ({request, includedHiddenTypes}) => {
        const scopedRepository = repositoryFactory.createScopedRepository(request, includedHiddenTypes);
        return {
          ...scopedRepository,
          get: async (type, id, options) => {
            throw new Error('Method not implemented');
          },
          create: async (type, attributes, options) => {
            throw new Error('Method not implemented');
          },
          update: async (type, id, attributes, options) => {
            throw new Error('Method not implemented');
          },
          delete: async (type, id, options) => {
            throw new Error('Method not implemented');
          },
          find: async (options) => {
            throw new Error('Method not implemented');
          },
          bulkCreate: async (objects, options) => {
            throw new Error('Method not implemented');
          },
          bulkGet: async (objects, options) => {
            throw new Error('Method not implemented');
          },
          bulkUpdate: async (objects, options) => {
            throw new Error('Method not implemented');
          },
          addToNamespaces: async (type, id, namespaces, options) => {
            throw new Error('Method not implemented');
          },
          deleteFromNamespaces: async (type, id, namespaces, options) => {
            throw new Error('Method not implemented');
          },
          checkConflicts: async (objects, options) => {
            throw new Error('Method not implemented');
          },
          errors: SavedObjectsErrorHelpers,
        };
      }
    };
    core.savedObjects.setClientFactoryProvider(clientFactoryProvider);

    const router = core.http.createRouter();

    // Register server side APIs
    defineRoutes(router);

    return {};
  }

  public start(core: CoreStart) {
    this.logger.info('metadata-plugin: Started');
    return {};
  }

  public stop() {}
}
