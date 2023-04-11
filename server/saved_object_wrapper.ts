/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable no-console */
import { omit } from 'lodash';
import {
  SavedObject,
  SavedObjectsAddToNamespacesOptions,
  SavedObjectsAddToNamespacesResponse,
  SavedObjectsBaseOptions,
  SavedObjectsBulkCreateObject,
  SavedObjectsBulkGetObject,
  SavedObjectsBulkResponse,
  SavedObjectsBulkUpdateObject,
  SavedObjectsBulkUpdateOptions,
  SavedObjectsBulkUpdateResponse,
  SavedObjectsCheckConflictsObject,
  SavedObjectsCheckConflictsResponse,
  SavedObjectsClientWrapperFactory,
  SavedObjectsCreateOptions,
  SavedObjectsDeleteByNamespaceOptions,
  SavedObjectsDeleteFromNamespacesOptions,
  SavedObjectsDeleteFromNamespacesResponse,
  SavedObjectsDeleteOptions,
  SavedObjectsFindOptions,
  SavedObjectsFindResponse,
  SavedObjectsUpdateOptions,
  SavedObjectsUpdateResponse,
  ISavedObjectTypeRegistry,
  SavedObjectsSerializer,
  SavedObjectsErrorHelpers,
  SavedObjectsRawDoc,
  SavedObjectsUtils,
  SavedObjectSanitizedDoc,
  SavedObjectsFindResult,
} from "../../../src/core/server";
import { IOpenSearchDashboardsMigrator } from 'src/core/server/saved_objects/migrations';
import { MetaStorageConfigType } from '.';

export const ALL_NAMESPACES_STRING = '*';

export class PostgresClientWrapper {
  public typeRegistry?: ISavedObjectTypeRegistry;
  private postgresClient: any;
  private serializer: SavedObjectsSerializer;
  private allowedTypes: string[];
  private _migrator: IOpenSearchDashboardsMigrator;
  public metaSrorageConfig?: MetaStorageConfigType;
  

  constructor() {
  }

  public setup() {
    const pg = require('pg');
  	this.postgresClient = new pg.Pool(this.getMetaStorageInitConfig());
    this.postgresClient.connect();

    this.serializer = new SavedObjectsSerializer(this.typeRegistry!);

    const allTypes = this.typeRegistry!.getAllTypes().map((t) => t.name);
    const visibleTypes = allTypes.filter((type) => !this.typeRegistry!.isHidden(type));

    // ToDO: how includeType will get here
    const includedHiddenTypes: string[] = [];
    this.allowedTypes = [...new Set(visibleTypes.concat(includedHiddenTypes))];

    // ToDO: How to get migrator here.
  }

  private getMetaStorageInitConfig() {
    const metaConfig = this.metaSrorageConfig!.config;
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

  public wrapperFactory: SavedObjectsClientWrapperFactory = (wrapperOptions) => {
    const create = async <T = unknown>(
      type: string,
      attributes: T,
      options: SavedObjectsCreateOptions = {}
    ): Promise<SavedObject<T>> => {
      console.log(`Inside create`);
      const version = options.version;
      const namespace = normalizeNamespace(options.namespace);
      const existingNamespaces: string[] | undefined = [];
      const raw = this.getSavedObjectRawDoc(
        type,
        attributes,
        options,
        namespace,
        existingNamespaces
      );
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
    };

    const bulkCreate = async <T = unknown>(
      objects: Array<SavedObjectsBulkCreateObject<T>>,
      options: SavedObjectsCreateOptions = {}
    ): Promise<SavedObjectsBulkResponse<T>> => {
      console.log(`Inside bulkCreate`);
      throw new Error('Method not implemented');
    };

    const checkConflicts = async (
      objects: SavedObjectsCheckConflictsObject[] = [],
      options: SavedObjectsBaseOptions = {}
    ): Promise<SavedObjectsCheckConflictsResponse> => {
      console.log(`Inside checkConflicts`);
      throw new Error('Method not implemented');
    };

    const deleteSavedObject = async (
      type: string,
      id: string,
      options: SavedObjectsDeleteOptions = {}
    ): Promise<{}> => {
      console.log(`Inside delete`);
      throw new Error('Method not implemented');
    };

    const deleteByNamespace = async (
      namespace: string,
      options: SavedObjectsDeleteByNamespaceOptions = {}
    ): Promise<any> => {
      console.log(`Inside deleteByNamespace`);
      throw new Error('Method not implemented');
    };

    const find = async <T = unknown>(
      options: SavedObjectsFindOptions
    ): Promise<SavedObjectsFindResponse<T>> => {
      console.log(`Inside metadata plugin find`);
      const {
        search,
        searchFields,
        page = 1,
        perPage = 20,
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
              } like_regex "${search.replace('*', '')}" flag "i")')`
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
    };

    const bulkGet = async <T = unknown>(
      objects: SavedObjectsBulkGetObject[] = [],
      options: SavedObjectsBaseOptions = {}
    ): Promise<SavedObjectsBulkResponse<T>> => {
      console.log(`Inside bulkGet`);
      throw new Error('Method not implemented');
    };

    const get = async <T = unknown>(
      type: string,
      id: string,
      options: SavedObjectsBaseOptions = {}
    ): Promise<SavedObject<T>> => {
      console.log(`Inside get`);
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
    FROM "metadatastore" where id='${this.serializer.generateRawId(namespace, type, id)}'`;

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
    if (!this.typeRegistry!.isNamespaceAgnostic(type)) {
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
    };

    const update = async <T = unknown>(
      type: string,
      id: string,
      attributes: Partial<T>,
      options: SavedObjectsUpdateOptions = {}
    ): Promise<SavedObjectsUpdateResponse<T>> => {
      console.log(`Inside update`);
      // ToDo: Do validation of some fields as we are doing in case of OpenSearch.

      const references = options.references ?? [];
      const namespace = normalizeNamespace(options.namespace);
      const time = this._getCurrentTime();

      const selectQuery = `SELECT "originid", "attributes" , "namespaces" 
      FROM "metadatastore" where id='${this.serializer.generateRawId(namespace, type, id)}'`;

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
          WHERE id='${this.serializer.generateRawId(namespace, type, id)}'`;
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
      if (!this.typeRegistry!.isNamespaceAgnostic(type)) {
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
    };

    const addToNamespaces = async (
      type: string,
      id: string,
      namespaces: string[],
      options: SavedObjectsAddToNamespacesOptions = {}
    ): Promise<SavedObjectsAddToNamespacesResponse> => {
      console.log(`Inside addToNamespaces`);
      throw new Error('Method not implemented');
    };

    const deleteFromNamespaces = async (
      type: string,
      id: string,
      namespaces: string[],
      options: SavedObjectsDeleteFromNamespacesOptions = {}
    ): Promise<SavedObjectsDeleteFromNamespacesResponse> => {
      console.log(`Inside deleteFromNamespaces`);
      throw new Error('Method not implemented');
    };

    const bulkUpdate = async <T = unknown>(
      objects: Array<SavedObjectsBulkUpdateObject<T>>,
      options: SavedObjectsBulkUpdateOptions = {}
    ): Promise<SavedObjectsBulkUpdateResponse<T>> => {
      console.log(`Inside bulkUpdate`);
      throw new Error('Method not implemented');
    };

    return {
      ...wrapperOptions.client,
      get,
      create,
      update,
      delete: deleteSavedObject,
      find,
      bulkCreate,
      bulkGet,
      bulkUpdate,
      addToNamespaces,
      deleteFromNamespaces,
      deleteByNamespace,
      checkConflicts,
    };
  };

  private _rawToSavedObject<T = unknown>(raw: SavedObjectsRawDoc): SavedObject<T> {
    const savedObject = this.serializer.rawToSavedObject(raw);
    const { namespace, type } = savedObject;
    if (this.typeRegistry!.isSingleNamespace(type)) {
      savedObject.namespaces = [SavedObjectsUtils.namespaceIdToString(namespace)];
    }
    return omit(savedObject, 'namespace') as SavedObject<T>;
  }

  private validateSavedObjectBeforeCreate(type: string, initialNamespaces?: string[]) {
    if (initialNamespaces) {
      if (!this.typeRegistry!.isMultiNamespace(type)) {
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
    if (!this.allowedTypes.includes(type)) {
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

    if (this.typeRegistry!.isSingleNamespace(type) && namespace) {
      savedObjectNamespace = namespace;
    } else if (this.typeRegistry!.isMultiNamespace(type)) {
      if (id && overwrite) {
        // we will overwrite a multi-namespace saved object if it exists; if that happens, ensure we preserve its included namespaces
        // note: this check throws an error if the object is found but does not exist in this namespace
        savedObjectNamespaces = initialNamespaces || existingNamespaces;
      } else {
        savedObjectNamespaces = initialNamespaces || getSavedObjectNamespaces(namespace);
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

    const raw = this.serializer.savedObjectToRaw(migrated as SavedObjectSanitizedDoc);
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
    const allowedTypes = types.filter((t) => this.allowedTypes.includes(t));
    return allowedTypes;
  }
}

function getSavedObjectNamespaces(
  namespace?: string,
  document?: SavedObjectsRawDoc
): string[] | undefined {
  if (document) {
    return document._source?.namespaces;
  }
  return [SavedObjectsUtils.namespaceIdToString(namespace)];
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
