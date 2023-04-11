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
import { PostgresClientWrapper } from './saved_object_wrapper';
import { MetaStorageConfigType } from '.';

export class MetadataPlugin implements Plugin<MetadataPluginSetup, MetadataPluginStart> {
  private readonly logger: Logger;
  private savedObjectClientWrapper: PostgresClientWrapper;
  private readonly config$;
  private config: MetaStorageConfigType;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
    this.savedObjectClientWrapper = new PostgresClientWrapper();
    this.config$ = initializerContext.config.create<MetaStorageConfigType>();
  }

  public async setup(core: CoreSetup) {
    this.logger.info('metadata-plugin: Setup');

    this.config = await this.config$.pipe(first()).toPromise();

    const router = core.http.createRouter();

    // Register server side APIs
    defineRoutes(router);

    core.savedObjects.addClientWrapper(
      0,
      'postgres-saved-object-client-wrapper',
      this.savedObjectClientWrapper.wrapperFactory
    );

    return {};
  }

  public async start(core: CoreStart) {
    this.logger.info('metadata-plugin: Started');

    this.savedObjectClientWrapper.typeRegistry = core.savedObjects.getTypeRegistry();
    console.log(`this.savedObjectClientWrapper.typeRegistry : ${this.savedObjectClientWrapper.typeRegistry}`);
    this.savedObjectClientWrapper.metaSrorageConfig = this.config;
    this.savedObjectClientWrapper.setup();
    return {};
  }

  public stop() {}
}
