import { ModuleDefinition, MODULE_RESOURCE_TYPE, MODULE_SCOPE } from "./types"

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    key: "stockLocationService",
    registrationName: "stockLocationService",
    defaultPackage: false,
    label: "StockLocationService",
    isRequired: false,
    canOverride: true,
    defaultModuleDeclaration: {
      scope: MODULE_SCOPE.INTERNAL,
      resources: MODULE_RESOURCE_TYPE.SHARED,
    },
  },
  {
    key: "inventoryService",
    registrationName: "inventoryService",
    defaultPackage: false,
    label: "InventoryService",
    isRequired: false,
    canOverride: true,
    defaultModuleDeclaration: {
      scope: MODULE_SCOPE.INTERNAL,
      resources: MODULE_RESOURCE_TYPE.SHARED,
    },
  },
  {
    key: "cacheService",
    registrationName: "cacheService",
    defaultPackage: "@medusa/cache-inmemory",
    label: "InMemoryCacheService",
    isRequired: true,
    canOverride: true,
    defaultModuleDeclaration: {
      scope: MODULE_SCOPE.INTERNAL,
      resources: MODULE_RESOURCE_TYPE.SHARED,
    },
  },
]

export default MODULE_DEFINITIONS
