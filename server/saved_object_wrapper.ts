/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable no-console */
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
} from 'opensearch-dashboards/server';

export class PostgresClientWrapper {
  constructor() {}

  public wrapperFactory: SavedObjectsClientWrapperFactory = (wrapperOptions) => {
    const create = async <T = unknown>(
      type: string,
      attributes: T,
      options: SavedObjectsCreateOptions = {}
    ): Promise<SavedObject<T>> => {
      console.log(`Inside create`);
      throw new Error('Method not implemented');
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
      console.log(`Inside find`);
      throw new Error('Method not implemented');
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
      throw new Error('Method not implemented');
    };

    const update = async <T = unknown>(
      type: string,
      id: string,
      attributes: Partial<T>,
      options: SavedObjectsUpdateOptions = {}
    ): Promise<SavedObjectsUpdateResponse<T>> => {
      console.log(`Inside update`);
      throw new Error('Method not implemented');
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
}
