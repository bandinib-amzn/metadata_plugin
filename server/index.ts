/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { schema, TypeOf } from "@osd/config-schema";
import { PluginInitializerContext, PluginConfigDescriptor } from '../../../src/core/server';
import { MetadataPlugin } from './plugin';

export type MetaStorageConfigType = TypeOf<typeof metaStorageConfig.schema>;
 
export const metaStorageConfig = {
  schema: schema.object({
    enabled: schema.boolean({ defaultValue: false }),
    config: schema.object({
      type: schema.string({
        defaultValue: 'opensearch',
        validate(value: string) {
          const supportedDbType = ['postgres', 'opensearch'];
 
          if (!supportedDbType.includes(value.toLowerCase())) {
            throw new Error(
              `Unsupported database type: ${value}. Allowed database types are: ${supportedDbType}.`
            );
          }
        },
      }),
      database: schema.string({ defaultValue: 'opensearch_dashboards' }),
      table: schema.string({ defaultValue: 'MetadataStore' }),
      hostName: schema.string({ defaultValue: '' }),
      userName: schema.string({ defaultValue: '' }),
      password: schema.string({ defaultValue: '' }),
      port: schema.number({ defaultValue: 0 }),
      max: schema.number({ defaultValue: 100 }),
      idleTimeoutMillis: schema.number({ defaultValue: 10000 }),
    }),
  }),
};

export const config: PluginConfigDescriptor<MetaStorageConfigType> = {
  exposeToBrowser: {
    enabled: true,
    config: true,
  },
  schema: metaStorageConfig.schema,
};

export function plugin(initializerContext: PluginInitializerContext) {
  return new MetadataPlugin(initializerContext);
}

export { MetadataPluginSetup, MetadataPluginStart } from './types';
