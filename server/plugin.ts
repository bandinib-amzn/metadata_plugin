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
  SavedObjectsSerializer,
} from '../../../src/core/server';
import { MetadataPluginSetup, MetadataPluginStart } from './types';
import { defineRoutes } from './routes';
import { MetaStorageConfigType } from '.';
import { PostgresRepository } from './postgres_repository';
import { DynamoDBRepository } from './dynamo_db_repositoty';
import { SavedObjectRepositoryFactoryProvider, SavedObjectsRepositoryOptions } from 'src/core/server/saved_objects/service/lib/scoped_client_provider';

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

    const repositoryFactoryProvider: SavedObjectRepositoryFactoryProvider = (
      options: SavedObjectsRepositoryOptions
    ) => {
      const {
        migrator,
        typeRegistry,
        includedHiddenTypes
     } = options;
     const allTypes = typeRegistry.getAllTypes().map((t) => t.name);
      const serializer = new SavedObjectsSerializer(typeRegistry);
      const visibleTypes = allTypes.filter((type) => !typeRegistry.isHidden(type));
    
      const missingTypeMappings = includedHiddenTypes.filter((type) => !allTypes.includes(type));
      if (missingTypeMappings.length > 0) {
        throw new Error(
          `Missing mappings for saved objects types: '${missingTypeMappings.join(', ')}'`
        );
      }
    
      const allowedTypes = [...new Set(visibleTypes.concat(includedHiddenTypes))];

      if(config.config.type == 'dynamodb'){
        return new DynamoDBRepository({
          typeRegistry,
          serializer,
          migrator,
          allowedTypes,
        });
      }
      else {
        PostgresRepository.metaSrorageConfig = config;
        return new PostgresRepository({
          typeRegistry,
          serializer,
          migrator,
          allowedTypes,
        });
      }
    }

    core.savedObjects.registerRepositoryFactoryProvider(repositoryFactoryProvider);

    return {};
  }

  public async start(core: CoreStart) {
    this.logger.info('metadata-plugin: Started');
    return {};
  }

  public stop() {}
}
