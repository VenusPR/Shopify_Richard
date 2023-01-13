import { ModuleExports } from "@medusajs/medusa"
import Loader from "./loaders"
import LocalEventBus from "./services/event-bus-local"

export const service = LocalEventBus
export const loaders = [Loader]

export default {
  service,
  loaders,
} as ModuleExports
