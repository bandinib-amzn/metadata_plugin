/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
    SavedObjectsAddToNamespacesOptions,
    SavedObjectsAddToNamespacesResponse,
    SavedObjectsBulkCreateObject,
    SavedObjectsBulkGetObject,
    SavedObjectsBulkResponse,
    SavedObjectsBulkUpdateObject,
    SavedObjectsBulkUpdateOptions,
    SavedObjectsBulkUpdateResponse,
    SavedObjectsCheckConflictsObject,
    SavedObjectsCheckConflictsResponse,
    SavedObjectsCreateOptions,
    SavedObjectsDeleteFromNamespacesOptions,
    SavedObjectsDeleteFromNamespacesResponse,
    SavedObjectsDeleteOptions,
    SavedObjectsFindResponse,
    ISavedObjectsRepository,
    SavedObjectsUpdateOptions,
    SavedObjectsUpdateResponse,
    SavedObjectsIncrementCounterOptions,
    SavedObjectsDeleteByNamespaceOptions,
    ISavedObjectTypeRegistry,
    SavedObjectsSerializer,
    SavedObjectsFindResult,
    SavedObjectsErrorHelpers,
    SavedObjectSanitizedDoc,
    SavedObjectsRawDoc,
    SavedObjectsUtils,
    SavedObjectTypeRegistry, 
} from "../../../src/core/server";
import { IOpenSearchDashboardsMigrator } from "src/core/server/saved_objects/migrations";
import { 
    SavedObjectsBaseOptions, 
    SavedObject,
    SavedObjectsFindOptions,
} from "src/core/server/types";
import { MetaStorageConfigType } from ".";
import { omit } from "lodash";
import { SavedObjectRepositoryFactoryProvider, SavedObjectsRepositoryOptions } from "src/core/server/saved_objects/service/lib/scoped_client_provider";
import { DecoratedError } from "src/core/server/saved_objects/service/lib/errors";
import { SavedObjectsRawDocSource } from "src/core/server/saved_objects/serialization";
import { Utils } from "./util";
import { encodeHitVersion } from "../../../src/core/server/saved_objects/version";

export const ALL_NAMESPACES_STRING = '*';
export const FIND_DEFAULT_PAGE = 1;
export const FIND_DEFAULT_PER_PAGE = 20;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Left = { tag: 'Left'; error: Record<string, any> };
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Right = { tag: 'Right'; value: Record<string, any> };
type Either = Left | Right;
const isLeft = (either: Either): either is Left => either.tag === 'Left';
const isRight = (either: Either): either is Right => either.tag === 'Right';

export interface PostgresRepositoryOptions {
  typeRegistry: SavedObjectTypeRegistry;
  serializer: SavedObjectsSerializer;
  migrator: IOpenSearchDashboardsMigrator;
  allowedTypes: string[];
}

export const repositoryFactoryProvider: SavedObjectRepositoryFactoryProvider = (
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

  return new PostgresRepository({
    typeRegistry,
    serializer,
    migrator,
    allowedTypes,
  });
}

export class PostgresRepository implements ISavedObjectsRepository {
    public _registry: ISavedObjectTypeRegistry;
    private postgresClient: any;
    private _serializer: SavedObjectsSerializer;
    private _allowedTypes: string[];
    private _migrator: IOpenSearchDashboardsMigrator;
    public static metaSrorageConfig?: MetaStorageConfigType;

    

    public static createRepository(
      migrator: IOpenSearchDashboardsMigrator,
      typeRegistry: SavedObjectTypeRegistry,
      includedHiddenTypes: string[] = []
    ): ISavedObjectsRepository {
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
  
      return new PostgresRepository({
        typeRegistry,
        serializer,
        migrator,
        allowedTypes,
      });
    }
    
    constructor(options: PostgresRepositoryOptions) {
      const {
        typeRegistry,
        serializer,
        migrator,
        allowedTypes = [],
      } = options;
      this._registry = typeRegistry;
      this._serializer = serializer;
      this._migrator = migrator;
      this._allowedTypes = allowedTypes;

      const pg = require('pg');
      this.postgresClient = new pg.Pool(this.getMetaStorageInitConfig());
      this.postgresClient.connect();
    }
    
    private getMetaStorageInitConfig() {
      const metaConfig = PostgresRepository.metaSrorageConfig!.config;
      const configSchema = {
        user: metaConfig.userName,
        password: metaConfig.password,
        database: metaConfig.database,
        host: metaConfig.hostName,
        port: metaConfig.port,
        max: metaConfig.max,
        idleTimeoutMillis: metaConfig.idleTimeoutMillis,
      };
    
      return configSchema;
    }
   
    async create<T = unknown>(
      type: string,
      attributes: T,
      options: SavedObjectsCreateOptions = {}
    ): Promise<SavedObject<T>> {
        console.log(`Inside PostgresRepository create`);
        const id = options.id;
        const overwrite = options.overwrite;
        // const refresh = options.refresh; // We don't need refresh for SQL operation.
        // ToDo: For now we are just storing version in table. Later we need to decide whether we want to use it for concurrency control or not.
        const version = options.version;

        const namespace = normalizeNamespace(options.namespace);
        let existingNamespaces: string[] | undefined;
        if (id && overwrite) {
          existingNamespaces = await this.preflightGetNamespaces(type, id, namespace);
        }

        const raw = this.getSavedObjectRawDoc(type, attributes, options, namespace, existingNamespaces);
        const query = `INSERT INTO metadatastore(id, type, version, attributes, reference, migrationversion, namespaces, originid, updated_at) 
        VALUES('${raw._id}', '${type}', '${version ?? ''}', '${JSON.stringify(raw._source)}', 
        '${JSON.stringify(raw._source.references)}', 
        '${JSON.stringify(raw._source.migrationVersion ?? {})}', 
        ${raw._source.namespaces ? `ARRAY[${raw._source.namespaces}]` : `'{}'`},
        '${raw._source.originId ?? ''}', '${raw._source.updated_at}')`;
        // ToDo: Decide if you want to keep raw._source or raw._source[type] in attributes field.
        // Above decision to be made after we decide on search functionality.
        await this.postgresClient
          .query(query)
          .then(() => {
            console.log('Saved object inserted in kibana table successfully.');
          })
          .catch((error: any) => {
            throw new Error(error);
          });

        return this._rawToSavedObject<T>({
          ...raw,
          // ...body, //ToDo: Check what is value of body in case of OpenSearch.
        });
    }
   
    async bulkCreate<T = unknown>(
      objects: Array<SavedObjectsBulkCreateObject<T>>,
      options: SavedObjectsCreateOptions = {}
    ): Promise<SavedObjectsBulkResponse<T>> {
        console.log(`Inside PostgresRepository bulkCreate`);
        const namespace = normalizeNamespace(options.namespace);
        // ToDo: Do validation of objects as we do in OpenSearch.
        // For sake of POC, we are just inserting all object in a loop.
        const query = `INSERT INTO metadatastore(id, type, version, attributes, reference, migrationversion, namespaces, originid, updated_at) VALUES `;

        const expectedBulkResult = objects.map((object) => {
          // const refresh = options.refresh; // We don't need refresh for SQL operation.
          // ToDo: For now we are just storing version in table. Later we need to decide whether we want to use it for concurrency control or not.
          const raw = this.getSavedObjectRawDoc(
            object.type,
            object.attributes,
            object as SavedObjectsCreateOptions,
            namespace,
            []
          );

          const insertValuesExpr = `('${raw._id}', '${object.type}',
        '${object.version ?? ''}', '${JSON.stringify(raw._source).replace(/'/g, `''`)}',
        '${JSON.stringify(raw._source.references)}',
        '${JSON.stringify(raw._source.migrationVersion ?? {})}',
        ${raw._source.namespaces ? `ARRAY[${raw._source.namespaces}]` : `'{}'`},
        '${raw._source.originId ?? ''}', '${raw._source.updated_at}')`;
          // ToDo: Decide if you want to keep raw._source or raw._source[type] in attributes field.
          // Refactor code to insert all rows in single transaction.
          this.postgresClient
            .query(`${query} ${insertValuesExpr}`)
            .then(() => {
              console.log('Saved object inserted in kibana table successfully.');
            })
            .catch((error: any) => {
              console.error(`error occurred for this query -> "${query} ${insertValuesExpr}"`);
              throw new Error(error);
            });
          const expectedResult = { rawMigratedDoc: raw };
          return { tag: 'Right' as 'Right', value: expectedResult };
        });

        return {
          saved_objects: expectedBulkResult.map((expectedResult) => {
            // When method == 'index' the bulkResponse doesn't include the indexed
            // _source so we return rawMigratedDoc but have to spread the latest
            // _seq_no and _primary_term values from the rawResponse.
            const { rawMigratedDoc } = expectedResult.value;
            return this._rawToSavedObject({
              ...rawMigratedDoc,
            });
          }),
        };
    }
   
    async checkConflicts(
      objects: SavedObjectsCheckConflictsObject[] = [],
      options: SavedObjectsBaseOptions = {}
    ): Promise<SavedObjectsCheckConflictsResponse> {
        console.log(`Inside PostgresRepository checkConflicts`);
        if (objects.length === 0) {
          return { errors: [] };
        }
    
        const namespace = normalizeNamespace(options.namespace);
        const errors: SavedObjectsCheckConflictsResponse['errors'] = [];
        const expectedBulkGetResults = objects.map((object) => {
          const { type, id } = object;
    
          if (!this._allowedTypes.includes(type)) {
            const error = {
              id,
              type,
              error: errorContent(SavedObjectsErrorHelpers.createUnsupportedTypeError(type)),
            };
            errors.push(error);
          }
    
          return {
            value: {
              type,
              id,
            },
          };
        });
        let results: any;
        await Promise.all(
          expectedBulkGetResults.map(async ({ value: { type, id } }) => {
            await this.postgresClient
              .query(
                `SELECT * FROM metadatastore where id='${this._serializer.generateRawId(
                  namespace,
                  type,
                  id
                )}'`
              )
              .then((res: any) => {
                results = res.rows[0];
                if (results && results.length > 0) {
                  errors.push({
                    id,
                    type,
                    error: {
                      ...errorContent(SavedObjectsErrorHelpers.createConflictError(type, id)),
                      // @ts-expect-error MultiGetHit._source is optional
                      ...(!this.rawDocExistsInNamespace(doc!, namespace) && {
                        metadata: { isNotOverwritable: true },
                      }),
                    },
                  });
                }
              })
              .catch((error: any) => {
                throw new Error(error);
              });
          })
        );
    
        return { errors };
    }
   
    async delete(type: string, id: string, options: SavedObjectsDeleteOptions = {}): Promise<{}> {
        console.log(`Inside PostgresRepository delete`);
        // ToDo: Validation same as we are doing in case .kibana index
        const namespace = normalizeNamespace(options.namespace);
        const rawId = this._serializer.generateRawId(namespace, type, id);
        const deleteQuery = `DELETE FROM metadatastore WHERE id='${rawId}'`;
        await this.postgresClient
          .query(`${deleteQuery}`)
          .then(() => {
            console.log(`'${rawId}' record deleted successfully.`);
          })
          .catch((error: any) => {
            console.error(`error occurred for this query -> "${deleteQuery}"`);
            throw new Error(error);
          });
        return {};
    }
   
    async deleteByNamespace(
      namespace: string,
      options: SavedObjectsDeleteByNamespaceOptions = {}
    ): Promise<any> {
        console.log(`Inside PostgresRepository deleteByNamespace`);
        if (!namespace || typeof namespace !== 'string' || namespace === '*') {
          throw new TypeError(`namespace is required, and must be a string that is not equal to '*'`);
        }
    
        // ToDo: Handle the case when the type is namespace-agnostic (global)
        // ToDo: Find out what needs to be done when namespace doesn't exists or empty. Do we want to delete saved object?
        const selectQuery = `select id, namespaces from metadatastore where ${namespace}=ANY(namespaces);`;
        let results: any;
        await this.postgresClient
          .query(selectQuery)
          .then((res: any) => {
            if (res?.rows.length > 0) results = res.rows;
          })
          .catch((error: any) => {
            throw new Error(error);
          });
    
        if (!results) {
          const time = this._getCurrentTime();
          await results.forEach((row: any) => {
            const newNamespace = row.namespaces.removeAll(namespace);
            const updateQuery = `UPDATE metadatastore SET 
            namespaces=${newNamespace ? `ARRAY[${newNamespace}]` : `'{}'`},
            updated_at='${time}'
            WHERE id='${row.id}'`;
            this.postgresClient
              .query(updateQuery)
              .then((res: any) => {
                console.log(`deleteByNamespace operation is successful for id=${row.id}`);
              })
              .catch((error: any) => {
                throw new Error(error);
              });
          });
        }
    }
   
    async find<T = unknown>(options: SavedObjectsFindOptions): Promise<SavedObjectsFindResponse<T>> {
        console.log(`Inside PostgresRepository find`);
        const {
          search,
          searchFields,
          page = FIND_DEFAULT_PAGE,
          perPage = FIND_DEFAULT_PER_PAGE,
          fields,
        } = options;
    
        this.validateTypeAndNamespace(options);
        const allowedTypes = this.getAllowedTypes(options);
        if (allowedTypes.length === 0) {
          return SavedObjectsUtils.createEmptyFindResponse<T>(options);
        }
    
        this.validateSearchFields(searchFields);
    
        this.validateFields(fields);
    
        let sql = `SELECT "id", "type", "version", "attributes", "reference", 
                  "migrationversion", "namespaces", "originid", "updated_at" 
                  FROM "metadatastore" where type IN(${allowedTypes
                    .map((type) => `'${type}'`)
                    .join(',')})`;
    
        let buildLikeExpr: string | undefined = '';
        if (search) {
          buildLikeExpr = searchFields
            ?.map(
              (field) =>
                `jsonb_path_exists(attributes, '$.* ? (@.${
                  field.split('^')[0]
                } like_regex "${search.replace(/\"/g,'').replace(/\*/g, '')}" flag "i")')`
            )
            .join(' OR ');
        }
        sql = buildLikeExpr ? `${sql} AND (${buildLikeExpr})` : `${sql}`;
        let results: any;
        await this.postgresClient
          .query(sql)
          .then((res: any) => {
            results = res.rows;
          })
          .catch((error: any) => {
            throw new Error(error);
          });
    
        // ToDO: Handle 404 case i.e. when the index is missing.
        if (!results || results.length === 0) {
          return {
            page,
            per_page: perPage,
            total: 0,
            saved_objects: [],
          };
        }
    
        return {
          page,
          per_page: perPage,
          total: results.length,
          saved_objects: results.map(
            (hit: any): SavedObjectsFindResult => ({
              ...this._rawToSavedObject({
                _source: hit.attributes,
                _id: hit.id,
                _seq_no: 1,
                _primary_term: 10,
              }),
              score: (hit as any)._score,
            })
          ),
        } as SavedObjectsFindResponse<T>;
    }
   
    async bulkGet<T = unknown>(
      objects: SavedObjectsBulkGetObject[] = [],
      options: SavedObjectsBaseOptions = {}
    ): Promise<SavedObjectsBulkResponse<T>> {
        console.log(`Inside PostgresRepository bulkGet`);
        const namespace = normalizeNamespace(options.namespace);

      if (objects.length === 0) {
        return { saved_objects: [] };
      }
      const expectedBulkGetResults = await Promise.all(
        objects.map(async (object) => {
          const { type, id } = object;
          const query = `SELECT "id", "type", "version", "attributes", "reference", 
          "migrationversion", "namespaces", "originid", "updated_at" 
          FROM "metadatastore" where id='${this._serializer.generateRawId(namespace, type, id)}'`;

          let results: any;
          await this.postgresClient
            .query(query)
            .then((res: any) => {
              results = res.rows[0];
            })
            .catch((error: any) => {
              throw new Error(error);
            });

          if (results) {
            const expectedResult = {
              type,
              id,
              results,
            };
            return { tag: 'Right' as 'Right', value: expectedResult };
          }
          return {
            tag: 'Left' as 'Left',
            error: {
              id,
              type,
              error: errorContent(SavedObjectsErrorHelpers.createGenericNotFoundError(type, id)),
            },
          };
        })
      );

      return {
        saved_objects: expectedBulkGetResults.map((expectedResult) => {
          if (isLeft(expectedResult)) {
            return expectedResult.error as any;
          }
          const { type, id, results } = expectedResult.value;

          if (!results || results.length === 0) {
            return ({
              id,
              type,
              error: errorContent(SavedObjectsErrorHelpers.createGenericNotFoundError(type, id)),
            } as any) as SavedObject<T>;
          }

          return getSavedObjectFromSource(this._registry, type, id, {
            _seq_no: 0,
            _primary_term: 0,
            _source: results.attributes,
          });
        }),
      };
    }
   
    async get<T = unknown>(
      type: string,
      id: string,
      options: SavedObjectsBaseOptions = {}
    ): Promise<SavedObject<T>> {
        console.log(`Inside PostgresRepository get`);
        this.validateType(type);

    const namespace = normalizeNamespace(options.namespace);

    // ToDo: Find out - 1. Why we are passing index to get api? 2. What is index for type? 3. whta is the index value in case of opensearch?
    /*
    const { body, statusCode } = await this.client.get<SavedObjectsRawDocSource>(
      {
        id: this._serializer.generateRawId(namespace, type, id),
        index: this.getIndexForType(type),
      },
      { ignore: [404] }
    );
    */
    // ToDo: Include index for type in where clause if needed.
    const query = `SELECT "id", "type", "version", "attributes", "reference", 
    "migrationversion", "namespaces", "originid", "updated_at" 
    FROM "metadatastore" where id='${this._serializer.generateRawId(namespace, type, id)}'`;

    let results: any;
    await this.postgresClient
      .query(query)
      .then((res: any) => {
        results = res.rows[0];
      })
      .catch((error: any) => {
        throw new Error(error);
      });

    // ToDo: Find out - 1. Do we need to handle index not found?
    // 2. Implement rawDocExistsInNamespace for RDS. We need convet attributes column to raw saved object and pass it existing rawDocExistsInNamespace.
    if (!results || results.length === 0)
      throw SavedObjectsErrorHelpers.createGenericNotFoundError(type, id);

    // const temp = results.attributes;

    const originId = results.originid;
    const updatedAt = results.updated_at;

    let namespaces: string[] = [];
    if (!this._registry.isNamespaceAgnostic(type)) {
      namespaces = results.namespaces ?? [SavedObjectsUtils.namespaceIdToString(results.namespace)];
    }

    // Todo: Research about version parameter
    return {
      id,
      type,
      namespaces,
      ...(originId && { originId }),
      ...(updatedAt && { updated_at: updatedAt }),
      // version: encodeHitVersion(body),
      attributes: results.attributes[type],
      references: results.references || [],
      migrationVersion: results.migrationVersion,
    };
    }
   
    async update<T = unknown>(
      type: string,
      id: string,
      attributes: Partial<T>,
      options: SavedObjectsUpdateOptions = {}
    ): Promise<SavedObjectsUpdateResponse<T>> {
        console.log(`Inside PostgresRepository update`);
        // ToDo: Do validation of some fields as we are doing in case of OpenSearch.

    const references = options.references ?? [];
    const namespace = normalizeNamespace(options.namespace);
    const time = this._getCurrentTime();

    const selectQuery = `SELECT "originid", "attributes" , "namespaces" 
    FROM "metadatastore" where id='${this._serializer.generateRawId(namespace, type, id)}'`;

    let results: any;
    await this.postgresClient
      .query(selectQuery)
      .then((res: any) => {
        if (res && res.rows.length > 0) {
          results = res.rows[0].attributes;
        }
      })
      .catch((error: any) => {
        throw new Error(error);
      });

    if (results) {
      results[type] = attributes;
      // Update attributes, references, updated_at
      const updateQuery = `UPDATE metadatastore SET 
        attributes='${JSON.stringify(results)}', 
        updated_at='${time}', reference='${JSON.stringify(references)}' 
        WHERE id='${this._serializer.generateRawId(namespace, type, id)}'`;
      await this.postgresClient
        .query(updateQuery)
        .then(() => {
          console.log(`update operation is successful.`);
        })
        .catch((error: any) => {
          throw new Error(error);
        });
    }

    const { originId } = results.originId ?? {};
    let namespaces: string[] = [];
    if (!this._registry.isNamespaceAgnostic(type)) {
      namespaces = results.namespaces ?? [];
    }

    return {
      id,
      type,
      updated_at: time,
      // version: encodeHitVersion(body),
      namespaces,
      ...(originId && { originId }),
      references,
      attributes: results,
    };
    }
   
    async addToNamespaces(
      type: string,
      id: string,
      namespaces: string[],
      options: SavedObjectsAddToNamespacesOptions = {}
    ): Promise<SavedObjectsAddToNamespacesResponse> {
        console.log(`Inside PostgresRepository addToNamespaces`);
        // ToDo: Validation
    const { namespace } = options;
    // we do not need to normalize the namespace to its ID format, since it will be converted to a namespace string before being used

    const rawId = this._serializer.generateRawId(undefined, type, id);
    const preflightResult = {} as SavedObjectsRawDoc;//await this.preflightCheckIncludesNamespace(type, id, namespace);
    const existingNamespaces = Utils.getSavedObjectNamespaces(undefined, preflightResult);
    // there should never be a case where a multi-namespace object does not have any existing namespaces
    // however, it is a possibility if someone manually modifies the document in OpenSearch
    const time = this._getCurrentTime();
    const newNamespaces = existingNamespaces
      ? unique(existingNamespaces.concat(namespaces))
      : namespaces;

    const updateQuery = `UPDATE metadatastore SET 
      namespaces=${newNamespaces ? `ARRAY[${newNamespaces}]` : `'{}'`},
      updated_at='${time}'
      WHERE id='${rawId}'`;
    this.postgresClient
      .query(updateQuery)
      .then(() => {
        console.log(`update operation is successful.`);
      })
      .catch((error: any) => {
        throw SavedObjectsErrorHelpers.createGenericNotFoundError(type, id);
      });

    return { namespaces: newNamespaces };
    }
   
    async deleteFromNamespaces(
      type: string,
      id: string,
      namespaces: string[],
      options: SavedObjectsDeleteFromNamespacesOptions = {}
    ): Promise<SavedObjectsDeleteFromNamespacesResponse> {
        console.log(`Inside PostgresRepository deleteFromNamespaces`);
        // ToDo: Validation as we are doing in case .kibana index
    const { namespace } = options;
    // we do not need to normalize the namespace to its ID format, since it will be converted to a namespace string before being used

    const rawId = this._serializer.generateRawId(undefined, type, id);
    const preflightResult = {} as SavedObjectsRawDoc; //await this.preflightCheckIncludesNamespace(type, id, namespace);
    const existingNamespaces = Utils.getSavedObjectNamespaces(undefined, preflightResult);
    // if there are somehow no existing namespaces, allow the operation to proceed and delete this saved object
    const remainingNamespaces = existingNamespaces?.filter((x) => !namespaces.includes(x));
    if (remainingNamespaces?.length) {
      // if there is 1 or more namespace remaining, update the saved object
      const time = this._getCurrentTime();

      const doc = {
        updated_at: time,
        namespaces: remainingNamespaces,
      };

      const updateQuery = `UPDATE metadatastore SET 
        namespaces=${remainingNamespaces ? `ARRAY[${remainingNamespaces}]` : `'{}'`},
        updated_at='${time}'
        WHERE id='${rawId}'`;
      this.postgresClient
        .query(updateQuery)
        .then(() => {
          console.log(`update operation is successful.`);
        })
        .catch(() => {
          throw SavedObjectsErrorHelpers.createGenericNotFoundError(type, id);
        });
      return { namespaces: doc.namespaces };
    } else {
      const deleteQuery = `DELETE FROM metadatastore WHERE id='${rawId}'`;
      await this.postgresClient
        .query(`${deleteQuery}`)
        .then(() => {
          return { namespaces: [] };
        })
        .catch((error: any) => {
          throw SavedObjectsErrorHelpers.createGenericNotFoundError(type, id);
        });
      throw SavedObjectsErrorHelpers.createGenericNotFoundError(type, id);
    }
    }
   
    async bulkUpdate<T = unknown>(
      objects: Array<SavedObjectsBulkUpdateObject<T>>,
      options: SavedObjectsBulkUpdateOptions = {}
    ): Promise<SavedObjectsBulkUpdateResponse<T>> {
        console.log(`Inside PostgresRepository bulkUpdate`);
        const time = this._getCurrentTime();
    const namespace = normalizeNamespace(options.namespace);
    if (objects.length === 0) {
      return { saved_objects: [] };
    }

    const expectedBulkResult = objects.map((object) => {
      const { type, id, attributes, references } = object;

      const selectQuery = `SELECT "originid", "attributes" , "namespaces" 
      FROM "metadatastore" where id='${this._serializer.generateRawId(namespace, type, id)}'`;

      let results: any;
      let existingAttributes: any;
      this.postgresClient
        .query(selectQuery)
        .then((res: any) => {
          if (res && res.rows.length > 0) {
            results = res.rows[0];
            existingAttributes = results.attributes;
          }
        })
        .catch((error: any) => {
          throw new Error(error);
        });

      if (results) {
        existingAttributes[type] = attributes;
        // Update attributes, references, updated_at
        const updateQuery = `UPDATE metadatastore SET 
          attributes='${JSON.stringify(existingAttributes)}', 
          updated_at='${time}', reference='${JSON.stringify(references)}' 
          WHERE id='${this._serializer.generateRawId(namespace, type, id)}'`;
        this.postgresClient
          .query(updateQuery)
          .then(() => {
            console.log(`update operation is successful.`);
          })
          .catch((error: any) => {
            throw new Error(error);
          });

        const expectedResult = {
          type,
          id,
          namespaces: results.namespaces,
          documentToSave: existingAttributes,
        };
        return { tag: 'Right' as 'Right', value: expectedResult };
      }
      return {
        tag: 'Left' as 'Left',
        error: {
          id,
          type,
          error: errorContent(SavedObjectsErrorHelpers.createGenericNotFoundError(type, id)),
        },
      };
    });

    return {
      saved_objects: expectedBulkResult.map((expectedResult) => {
        if (isLeft(expectedResult)) {
          return expectedResult.error as any;
        }
        const { type, id, namespaces, documentToSave } = expectedResult.value;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { [type]: attributes, references, updated_at } = documentToSave;
        return {
          id,
          type,
          ...(namespaces && { namespaces }),
          // ...(originId && { originId }),
          updated_at,
          // version: encodeVersion(seqNo, primaryTerm),
          attributes,
          references,
        };
      }),
    };
    }
   
    async incrementCounter(
      type: string,
      id: string,
      counterFieldName: string,
      options: SavedObjectsIncrementCounterOptions = {}
    ): Promise<SavedObject> {
        console.log(`Inside PostgresRepository incrementCounter`);
        // ToDo: Do validation of some fields as we are doing in case of OpenSearch.
    const namespace = normalizeNamespace(options.namespace);
    const time = this._getCurrentTime();
    const existingNamespaces = await this.preflightGetNamespaces(type, id, namespace);
    const raw = this.getSavedObjectRawDoc(
      type,
      { [counterFieldName]: 1 },
      options,
      namespace,
      existingNamespaces
    );

    const selectQuery = `SELECT "attributes" FROM "metadatastore" where id='${raw._id}'`;

    let attributes: any;
    await this.postgresClient
      .query(selectQuery)
      .then((res: any) => {
        if (res && res.rows.length > 0) {
          attributes = res.rows[0].attributes;
        }
      })
      .catch((error: any) => {
        throw new Error(error);
      });

    if (attributes) {
      if (attributes[type][counterFieldName] == null) {
        attributes[type][counterFieldName] = 1;
      } else {
        attributes[type][counterFieldName] += 1;
      }

      const updateQuery = `UPDATE metadatastore SET attributes=${attributes}, updated_at=${time} WHERE id=${raw._id}`;
      await this.postgresClient
        .query(updateQuery)
        .then((res: any) => {
          raw._source = attributes;
        })
        .catch((error: any) => {
          throw new Error(error);
        });
    } else {
      raw._source[type][counterFieldName] = 1;
      const insertQuery = `INSERT INTO metadatastore(id, type, attributes, reference, migrationversion, namespaces, originid, updated_at) 
        VALUES('${raw._id}', '${type}', '${JSON.stringify(raw._source)}', 
        '${JSON.stringify(raw._source.references)}', 
        '${JSON.stringify(raw._source.migrationVersion ?? {})}', 
        '${JSON.stringify(raw._source.namespaces ?? [])}',
        '${raw._source.originId ?? ''}', '${raw._source.updated_at}')`;
      // ToDo: Decide if you want to keep raw._source or raw._source[type] in attributes field.
      await this.postgresClient
        .query(insertQuery)
        .then(() => {
          console.log('Saved object inserted in kibana table successfully.');
        })
        .catch((error: any) => {
          throw new Error(error);
        });
    }

    return this._rawToSavedObject({
      ...raw,
    });
    }

    private _rawToSavedObject<T = unknown>(raw: SavedObjectsRawDoc): SavedObject<T> {
        const savedObject = this._serializer.rawToSavedObject(raw);
        const { namespace, type } = savedObject;
        if (this._registry!.isSingleNamespace(type)) {
          savedObject.namespaces = [SavedObjectsUtils.namespaceIdToString(namespace)];
        }
        return omit(savedObject, 'namespace') as SavedObject<T>;
      }
    
      private validateSavedObjectBeforeCreate(type: string, initialNamespaces?: string[]) {
        if (initialNamespaces) {
          if (!this._registry!.isMultiNamespace(type)) {
            throw SavedObjectsErrorHelpers.createBadRequestError(
              '"options.initialNamespaces" can only be used on multi-namespace types'
            );
          } else if (!initialNamespaces.length) {
            throw SavedObjectsErrorHelpers.createBadRequestError(
              '"options.initialNamespaces" must be a non-empty array of strings'
            );
          }
        }
    
        this.validateType(type);
      }
    
      private validateType(type: string) {
        if (!this._allowedTypes.includes(type)) {
          throw SavedObjectsErrorHelpers.createUnsupportedTypeError(type);
        }
      }
    
      private _getCurrentTime() {
        return new Date().toISOString();
      }
    
      private getSavedObjectRawDoc<T = unknown>(
        type: string,
        attributes: T,
        options: SavedObjectsCreateOptions,
        namespace?: string,
        existingNamespaces?: string[]
      ) {
        const {
          id,
          migrationVersion,
          overwrite = false,
          references = [],
          originId,
          initialNamespaces,
        } = options;
    
        this.validateSavedObjectBeforeCreate(type, initialNamespaces);
    
        const time = this._getCurrentTime();
        let savedObjectNamespace;
        let savedObjectNamespaces: string[] | undefined;
    
        if (this._registry!.isSingleNamespace(type) && namespace) {
          savedObjectNamespace = namespace;
        } else if (this._registry!.isMultiNamespace(type)) {
          if (id && overwrite) {
            // we will overwrite a multi-namespace saved object if it exists; if that happens, ensure we preserve its included namespaces
            // note: this check throws an error if the object is found but does not exist in this namespace
            savedObjectNamespaces = initialNamespaces || existingNamespaces;
          } else {
            savedObjectNamespaces = initialNamespaces || Utils.getSavedObjectNamespaces(namespace);
          }
        }
        //ToDO: how can we do migrateDocument in plugin.
        //const migrated = this._migrator.migrateDocument({
        const migrated = {
          id,
          type,
          ...(savedObjectNamespace && { namespace: savedObjectNamespace }),
          ...(savedObjectNamespaces && { namespaces: savedObjectNamespaces }),
          originId,
          attributes,
          migrationVersion,
          updated_at: time,
          ...(Array.isArray(references) && { references }),
        };
    
        const raw = this._serializer.savedObjectToRaw(migrated as SavedObjectSanitizedDoc);
        return raw;
      }
    
      private validateTypeAndNamespace(options: SavedObjectsFindOptions) {
        const { namespaces, type, typeToNamespacesMap } = options;
        if (!type && !typeToNamespacesMap) {
          throw SavedObjectsErrorHelpers.createBadRequestError(
            'options.type must be a string or an array of strings'
          );
        } else if (namespaces?.length === 0 && !typeToNamespacesMap) {
          throw SavedObjectsErrorHelpers.createBadRequestError(
            'options.namespaces cannot be an empty array'
          );
        } else if (type && typeToNamespacesMap) {
          throw SavedObjectsErrorHelpers.createBadRequestError(
            'options.type must be an empty string when options.typeToNamespacesMap is used'
          );
        } else if ((!namespaces || namespaces?.length) && typeToNamespacesMap) {
          throw SavedObjectsErrorHelpers.createBadRequestError(
            'options.namespaces must be an empty array when options.typeToNamespacesMap is used'
          );
        }
      }
    
      private validateSearchFields(searchFields?: string[]) {
        if (searchFields && !Array.isArray(searchFields)) {
          throw SavedObjectsErrorHelpers.createBadRequestError('options.searchFields must be an array');
        }
      }
    
      private validateFields(fields?: string[]) {
        if (fields && !Array.isArray(fields)) {
          throw SavedObjectsErrorHelpers.createBadRequestError('options.fields must be an array');
        }
      }
    
      private getAllowedTypes(options: SavedObjectsFindOptions) {
        const { type, typeToNamespacesMap } = options;
        const types = type
          ? Array.isArray(type)
            ? type
            : [type]
          : Array.from(typeToNamespacesMap!.keys());
        const allowedTypes = types.filter((t) => this._allowedTypes.includes(t));
        return allowedTypes;
      }

      /**
      * Pre-flight check to get a multi-namespace saved object's included namespaces. This ensures that, if the saved object exists, it
      * includes the target namespace.
      *
      * @param type The type of the saved object.
      * @param id The ID of the saved object.
      * @param namespace The target namespace.
      * @returns Array of namespaces that this saved object currently includes, or (if the object does not exist yet) the namespaces that a
      * newly-created object will include. Value may be undefined if an existing saved object has no namespaces attribute; this should not
      * happen in normal operations, but it is possible if the OpenSearch document is manually modified.
      * @throws Will throw an error if the saved object exists and it does not include the target namespace.
      */
      public async preflightGetNamespaces(type: string, id: string, namespace?: string) {
        if (!this._registry.isMultiNamespace(type)) {
          throw new Error(`Cannot make preflight get request for non-multi-namespace type '${type}'.`);
        }
        const sql = `SELECT * FROM metadatastore 
        where id='${this._serializer.generateRawId(namespace, type, id)}'`;
        const results = await Utils.executeGetQuery(this.postgresClient, sql);
     
        if (!results || results.length === 0){
          return Utils.getSavedObjectNamespaces(namespace);
        }else{
          const body = {
                    _source: results.attributes,
                    //_index: this.getIndexForType(type),
                    _id: results.id,
                    found: false
                };
     
          if (!this.rawDocExistsInNamespace(body, namespace)) {
            throw SavedObjectsErrorHelpers.createConflictError(type, id);
          }
          return Utils.getSavedObjectNamespaces(namespace, body);
        }
      }

      /**
   * Check to ensure that a raw document exists in a namespace. If the document is not a multi-namespace type, then this returns `true` as
   * we rely on the guarantees of the document ID format. If the document is a multi-namespace type, this checks to ensure that the
   * document's `namespaces` value includes the string representation of the given namespace.
   *
   * WARNING: This should only be used for documents that were retrieved from OpenSearch. Otherwise, the guarantees of the document ID
   * format mentioned above do not apply.
   */
  private rawDocExistsInNamespace(raw: SavedObjectsRawDoc, namespace: string | undefined) {
    const rawDocType = raw._source.type;

    // if the type is namespace isolated, or namespace agnostic, we can continue to rely on the guarantees
    // of the document ID format and don't need to check this
    if (!this._registry.isMultiNamespace(rawDocType)) {
      return true;
    }

    const namespaces = raw._source.namespaces;
    const existsInNamespace =
      namespaces?.includes(SavedObjectsUtils.namespaceIdToString(namespace)) ||
      namespaces?.includes('*');
    return existsInNamespace ?? false;
  }
  }
  
const normalizeNamespace = (namespace?: string) => {
  if (namespace === ALL_NAMESPACES_STRING) {
    throw SavedObjectsErrorHelpers.createBadRequestError('"options.namespace" cannot be "*"');
  } else if (namespace === undefined) {
    return namespace;
  } else {
    return SavedObjectsUtils.namespaceStringToId(namespace);
  }
};

/**
 * Extracts the contents of a decorated error to return the attributes for bulk operations.
 */
const errorContent = (error: DecoratedError) => error.output.payload;

function getSavedObjectFromSource<T>(
  registry: ISavedObjectTypeRegistry,
  type: string,
  id: string,
  doc: { _seq_no?: number; _primary_term?: number; _source: SavedObjectsRawDocSource }
): SavedObject<T> {
  const { originId, updated_at: updatedAt } = doc._source;

  let namespaces: string[] = [];
  if (!registry.isNamespaceAgnostic(type)) {
    namespaces = doc._source.namespaces ?? [
      SavedObjectsUtils.namespaceIdToString(doc._source.namespace),
    ];
  }

  return {
    id,
    type,
    namespaces,
    ...(originId && { originId }),
    ...(updatedAt && { updated_at: updatedAt }),
    version: encodeHitVersion(doc),
    attributes: doc._source[type],
    references: doc._source.references || [],
    migrationVersion: doc._source.migrationVersion,
  };
}

const unique = (array: string[]) => [...new Set(array)];