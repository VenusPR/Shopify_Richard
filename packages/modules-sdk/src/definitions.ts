import { ModuleDefinition, MODULE_RESOURCE_TYPE, MODULE_SCOPE } from "./types"

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    key: "stockLocationService",
    registrationName: "stockLocationService",
    defaultPackage: false,
    label: "StockLocationService",
    isRequired: false,
    canOverride: true,
    dependencies: ["eventBusService"],
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
    dependencies: ["eventBusService"],
    defaultModuleDeclaration: {
      scope: MODULE_SCOPE.INTERNAL,
      resources: MODULE_RESOURCE_TYPE.SHARED,
    },
  },
]

export default MODULE_DEFINITIONS
