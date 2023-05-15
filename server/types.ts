/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { IOpenSearchDashboardsMigrator } from "src/core/server/saved_objects/migrations";
import { SavedObjectTypeRegistry, SavedObjectsSerializer } from "../../../src/core/server";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MetadataPluginSetup {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MetadataPluginStart {}

export interface RepositoryOptions {
    typeRegistry: SavedObjectTypeRegistry;
    serializer: SavedObjectsSerializer;
    migrator: IOpenSearchDashboardsMigrator;
    allowedTypes: string[];
  }
