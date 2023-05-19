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
import { 
  DynamoDBClient, 
  GetItemCommand, 
  GetItemCommandInput, 
  PutItemCommand, 
  PutItemCommandInput, 
  QueryCommand, 
  QueryCommandInput, 
  DeleteItemCommand, 
  DeleteItemCommandInput,
  UpdateItemCommand,
  UpdateItemCommandInput
 } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { RepositoryOptions } from "./types";
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


export class DynamoDBRepository implements ISavedObjectsRepository {
  private dynamoDBClient: any;
  public _registry: ISavedObjectTypeRegistry;
  private _serializer: SavedObjectsSerializer;
  private _allowedTypes: string[];
  private _migrator: IOpenSearchDashboardsMigrator;

  constructor(options: RepositoryOptions) {
    console.log(`Inside DynamoDBRepository constructor`);
    
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

    // Initialize DynamoDB client with credentials
    this.dynamoDBClient = new DynamoDBClient({ region: 'us-west-2' });
  }

  async create<T = unknown>(
    type: string,
    attributes: T,
    options: SavedObjectsCreateOptions = {}
  ): Promise<SavedObject<T>> {
    console.log(`Inside DynamoDBRepository create`);
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
    
    const params: PutItemCommandInput = {
      TableName: "metadatastore",
      Item: marshall({
          "application_id":  "neo_app_2",
          "id": raw._id,
          "type": type,
          "version": version ?? '',
          "attributes": raw._source[type],
          "namespaces": raw._source.namespaces ?? [],
          "reference": raw._source.references,
          "migrationversion": raw._source.migrationversion ?? {},
          "originid": raw._source.originid ?? '',
          "updated_at": raw._source.updated_at,
      })
    };

    try {
      const results = await this.dynamoDBClient.send(new PutItemCommand(params));
      console.log(results)
    } catch(err) {
        console.error(err)
    }

    return this._rawToSavedObject<T>({
      ...raw,
      // ...body, //ToDo: Check what is value of body in case of OpenSearch.
    });
  }

  async bulkCreate<T = unknown>(
    objects: Array<SavedObjectsBulkCreateObject<T>>,
    options: SavedObjectsCreateOptions = {}
  ): Promise<SavedObjectsBulkResponse<T>> {
    console.log(`Inside DynamoDBRepository bulkCreate`);
    const namespace = normalizeNamespace(options.namespace);
    // ToDo: Do validation of objects as we do in OpenSearch.
    // For sake of POC, we are just inserting all object in a loop.
    
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

      const params: PutItemCommandInput = {
        TableName: "metadatastore",
        Item: marshall({
            "application_id":  "neo_app_2",
            "id": raw._id,
            "type": object.type,
            "version": object.version ?? '',
            "attributes": raw._source[object.type].replace(/'/g, `''`),
            "namespaces": raw._source.namespaces ?? [],
            "reference": raw._source.references,
            "migrationversion": raw._source.migrationversion ?? {},
            "originid": raw._source.originid ?? '',
            "updated_at": raw._source.updated_at,
        })
      };
  
      try {
        const results = this.dynamoDBClient.send(new PutItemCommand(params));
        console.log(results)
      } catch(err) {
          console.error(err)
      }
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
    throw new Error('Method not implemented');
  }
  
  async delete(type: string, id: string, options: SavedObjectsDeleteOptions = {}): Promise<{}> {
    console.log(`Inside DynamoDBRepository delete`);
    // ToDo: Validation same as we are doing in case .kibana index
    const namespace = normalizeNamespace(options.namespace);
    const rawId = this._serializer.generateRawId(namespace, type, id);

    const params: DeleteItemCommandInput = {
      TableName: "metadatastore",
      Key: marshall({
        "application_id": "neo_app_2", 
        "id": rawId,
      }),
    };

    try {
      const results = this.dynamoDBClient.send(new DeleteItemCommand(params));
      console.log(results)
    } catch(err) {
        console.error(err)
    }
    
    return {};
  }
  
  async deleteByNamespace(
    namespace: string,
    options: SavedObjectsDeleteByNamespaceOptions = {}
  ): Promise<any> {
    throw new Error('Method not implemented');
  }
  
  async find<T = unknown>(options: SavedObjectsFindOptions): Promise<SavedObjectsFindResponse<T>> {
    console.log(`Inside DynamoDBRepository find`);
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

    // Fetch based on application id
    //Filter only based on Title and Description.

    let results: any;
    const params: QueryCommandInput = {
      TableName : "metadatastore",
      KeyConditionExpression: "#app_id = :app_id",
      ExpressionAttributeNames: {
          "#app_id": "application_id",
      },
    };
    if(search)
    {
      params.FilterExpression = 'contains(attributes.title, :search) or contains(attributes.description, :search)';
      params.ExpressionAttributeValues = marshall({
        ':app_id': 'neo_app_2',
        ':search': search ? search.replace(/\"/g,'').replace(/\*/g, '') : '',
      })
    }
    else 
    {
      params.ExpressionAttributeValues = marshall({
        ':app_id': 'neo_app_2'
      })
    }

    try {
      const res = await this.dynamoDBClient.send(new QueryCommand(params));
      const tempResults = res.Items.map((item: any) => unmarshall(item));
      console.log(`Total results fetched from DynamoDb : ${tempResults.length}`);
      console.log(`sample result from DynamoDb : ${JSON.stringify(tempResults[1])}`);
      //Filter records in memory to only return the ones that are of the allowed types.
      results =  tempResults.filter((item: any) => allowedTypes.includes(item.type));
      console.log(`Total final results after applying filter : ${results.length}`);
    } catch (err) {
      console.error(err);
    }

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
        (hit: any): SavedObjectsFindResult => {
          const currType = hit.type;
          return {
            ...this._rawToSavedObject({
              _source: { type: currType, [currType]: hit.attributes },
              _id: hit.id,
            }),
            migrationVersion: hit.migrationversion,
            updated_at: hit.updated_at,
            version: hit.version,
            score: (hit as any)._score,
          };
        }
      ),
    } as SavedObjectsFindResponse<T>;
  }
  
  async bulkGet<T = unknown>(
    objects: SavedObjectsBulkGetObject[] = [],
    options: SavedObjectsBaseOptions = {}
  ): Promise<SavedObjectsBulkResponse<T>> {
    console.log(`Inside DynamoDBRepository bulkGet`);
    const namespace = normalizeNamespace(options.namespace);

    if (objects.length === 0) {
      return { saved_objects: [] };
    }
    const expectedBulkGetResults = await Promise.all(
      objects.map(async (object) => {
        const { type, id } = object;
        const params: GetItemCommandInput = {
          TableName: "metadatastore",
          Key: marshall({
            "application_id": "neo_app_2", 
            "id": this._serializer.generateRawId(namespace, type, id),
          }),
        };

        let results: any;
        
        try {
          const res = await this.dynamoDBClient.send(new GetItemCommand(params));
          results= unmarshall(res.Item);
        } catch(err) {
            console.error(err)
        }

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
          _source: { type: type, [type]: results.attributes },
        });
      }),
    };
  }
  
  async get<T = unknown>(
    type: string,
    id: string,
    options: SavedObjectsBaseOptions = {}
  ): Promise<SavedObject<T>> {
    console.log(`Inside DynamoDbRepository get`);
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
    const params: GetItemCommandInput = {
      TableName: "metadatastore",
      Key: marshall({
        "application_id": "neo_app_2", 
        "id": this._serializer.generateRawId(namespace, type, id),
      }),
    };

    let results: any;
    try {
      const res = await this.dynamoDBClient.send(new GetItemCommand(params));
      results= unmarshall(res.Item)
      console.log(results);
    } catch(err) {
        console.error(err)
    }

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
    const temp = {
      id,
      type,
      namespaces,
      ...(originId && { originId }),
      ...(updatedAt && { updated_at: updatedAt }),
      // version: encodeHitVersion(body),
      attributes: results.attributes,
      references: results.references || [],
      migrationVersion: results.migrationVersion,
    };
    console.log(`temp: ${JSON.stringify(temp)}`);
    return temp;
  }
  
  async update<T = unknown>(
    type: string,
    id: string,
    attributes: Partial<T>,
    options: SavedObjectsUpdateOptions = {}
  ): Promise<SavedObjectsUpdateResponse<T>> {
    console.log(`Inside DynamoDbRepository update`);
    // ToDo: Do validation of some fields as we are doing in case of OpenSearch.

    const references = options.references ?? [];
    const namespace = normalizeNamespace(options.namespace);
    const time = this._getCurrentTime();
    let results: any;

    const params: UpdateItemCommandInput = {
      TableName: "metadatastore",
      UpdateExpression: "SET attributes = :attributes, updated_at = :updated_at, #ref = :references",
      ExpressionAttributeNames: {
        "#ref": "references",
      },
      ExpressionAttributeValues: marshall({
        ':attributes': attributes,
        ':updated_at': time,
        ':references': references,
      }),
      ReturnValues: "ALL_NEW",
      Key: marshall({
        "application_id": "neo_app_2", 
        "id": this._serializer.generateRawId(namespace, type, id),
      }),
    };

    try {
      const res = await this.dynamoDBClient.send(new UpdateItemCommand(params));
      results= unmarshall(res.Attributes)
      console.log(results);
    } catch(err) {
        console.error(err)
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
    throw new Error('Method not implemented');
  }
  
  async deleteFromNamespaces(
    type: string,
    id: string,
    namespaces: string[],
    options: SavedObjectsDeleteFromNamespacesOptions = {}
  ): Promise<SavedObjectsDeleteFromNamespacesResponse> {
    throw new Error('Method not implemented');
  }
  
  async bulkUpdate<T = unknown>(
    objects: Array<SavedObjectsBulkUpdateObject<T>>,
    options: SavedObjectsBulkUpdateOptions = {}
  ): Promise<SavedObjectsBulkUpdateResponse<T>> {
    throw new Error('Method not implemented');
  }
  
  async incrementCounter(
    type: string,
    id: string,
    counterFieldName: string,
    options: SavedObjectsIncrementCounterOptions = {}
  ): Promise<SavedObject> {
    throw new Error('Method not implemented');
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
    // if (!this._registry.isMultiNamespace(type)) {
    //   throw new Error(`Cannot make preflight get request for non-multi-namespace type '${type}'.`);
    // }
    // const sql = `SELECT * FROM metadatastore 
    // where id='${this._serializer.generateRawId(namespace, type, id)}'`;
    // const results = await Utils.executeGetQuery(this.postgresClient, sql);
 
    // if (!results || results.length === 0){
    //   return Utils.getSavedObjectNamespaces(namespace);
    // }else{
    //   const body = {
    //             _source: results.attributes,
    //             //_index: this.getIndexForType(type),
    //             _id: results.id,
    //             found: false
    //         };
 
    //   if (!this.rawDocExistsInNamespace(body, namespace)) {
    //     throw SavedObjectsErrorHelpers.createConflictError(type, id);
    //   }
    //   return Utils.getSavedObjectNamespaces(namespace, body);
    // }
    return Utils.getSavedObjectNamespaces(namespace);
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