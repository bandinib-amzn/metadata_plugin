/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { first } from 'rxjs/operators';
import {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '../../../src/core/server';
import { MetadataPluginSetup, MetadataPluginStart } from './types';
import { defineRoutes } from './routes';
import { MetaStorageConfigType } from '.';
import { PostgresRepository, repositoryFactoryProvider } from './postgres_repository';

export class MetadataPlugin implements Plugin<MetadataPluginSetup, MetadataPluginStart> {
  private readonly logger: Logger;
  private readonly config$;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
    this.config$ = initializerContext.config.create<MetaStorageConfigType>();
  }

  public async setup(core: CoreSetup) {
    this.logger.info('metadata-plugin: Setup');

    const config = await this.config$.pipe(first()).toPromise();

    const router = core.http.createRouter();

    // Register server side APIs
    defineRoutes(router);

    PostgresRepository.metaSrorageConfig = config;

    core.savedObjects.registerRepositoryFactoryProvider(repositoryFactoryProvider);

    return {};
  }

  public async start(core: CoreStart) {
    this.logger.info('metadata-plugin: Started');
    return {};
  }

  public stop() {}
}
