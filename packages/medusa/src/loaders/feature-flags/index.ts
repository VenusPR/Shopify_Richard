import path from "path"
import glob from "glob"

import { FlagSettings } from "../../types/feature-flags"
import { FlagRouter } from "../../utils/flag-router"

const isTruthy = (val: string | boolean | undefined): boolean => {
  if (typeof val === "string") {
    return val.toLowerCase() === "true"
  }
  return !!val
}

export default async (
  configModule: { featureFlags: Record<string, string | boolean> },
  flagDirectory?: string
): Promise<FlagRouter> => {
  let { featureFlags: projectConfigFlags } = configModule
  projectConfigFlags = projectConfigFlags || {}

  const flagDir = path.join(flagDirectory || __dirname, "*.js")
  const supportedFlags = glob.sync(flagDir, {
    ignore: ["**/index.js"],
  })

  const flagConfig: Record<string, boolean> = {}
  for (const flag of supportedFlags) {
    let flagSettings: FlagSettings
    const importedModule = await import(flag)
    if (importedModule.default) {
      flagSettings = importedModule.default
    } else {
      continue
    }

    switch (true) {
      case typeof process.env[flagSettings.env_key] !== "undefined":
        flagConfig[flagSettings.key] = isTruthy(
          process.env[flagSettings.env_key]
        )
        break
      case typeof projectConfigFlags[flagSettings.key] !== "undefined":
        flagConfig[flagSettings.key] = isTruthy(
          projectConfigFlags[flagSettings.key]
        )
        break
      default:
        flagConfig[flagSettings.key] = flagSettings.default_val
    }
  }

  return new FlagRouter(flagConfig)
}
