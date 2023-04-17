/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { SavedObjectsRawDoc, SavedObjectsUtils } from "../../../src/core/server";

export class Utils {
    public static async executeGetQuery(client: any, sql: string): Promise<any> {
        let results: any;
        await client
            .query(sql)
            .then((res: any) => {
            results = res.rows[0];
            })
            .catch((error: any) => {
            throw new Error(error);
            });
        return results;
    }

    /**
    * Returns a string array of namespaces for a given saved object. If the saved object is undefined, the result is an array that contains the
    * current namespace. Value may be undefined if an existing saved object has no namespaces attribute; this should not happen in normal
    * operations, but it is possible if the OpenSearch document is manually modified.
    *
    * @param namespace The current namespace.
    * @param document Optional existing saved object that was obtained in a preflight operation.
    */
    public static getSavedObjectNamespaces(
        namespace?: string,
        document?: SavedObjectsRawDoc
      ): string[] | undefined {
        if (document) {
          return document._source?.namespaces;
        }
        return [SavedObjectsUtils.namespaceIdToString(namespace)];
      }
}