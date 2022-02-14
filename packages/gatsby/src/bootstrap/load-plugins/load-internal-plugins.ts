import { slash } from "gatsby-core-utils"
import path from "path"
import reporter from "gatsby-cli/lib/reporter"
import { silent as resolveFromSilent } from "resolve-from"
import * as semver from "semver"
import { store } from "../../redux"
import {
  IPluginInfo,
  PluginRef,
  IPluginRefObject,
  IPluginRefOptions,
  ISiteConfig,
} from "./types"
import { COMPILED_CACHE_DIR } from "../../utils/parcel/compile-gatsby-files"
import { processPlugin } from "./process-plugin"
import { createPluginId } from "./create-id"
import { createFileContentHash } from "./create-hash"

const GATSBY_CLOUD_PLUGIN_NAME = `gatsby-plugin-gatsby-cloud`
const TYPESCRIPT_PLUGIN_NAME = `gatsby-plugin-typescript`

async function addGatsbyPluginCloudPluginWhenInstalled(
  plugins: Array<IPluginInfo>,
  processPlugin: (plugin: PluginRef) => Promise<IPluginInfo>,
  rootDir: string
): Promise<void> {
  const cloudPluginLocation = resolveFromSilent(
    rootDir,
    GATSBY_CLOUD_PLUGIN_NAME
  )

  if (cloudPluginLocation) {
    const processedGatsbyCloudPlugin = await processPlugin({
      resolve: cloudPluginLocation,
      options: {},
    })
    plugins.push(processedGatsbyCloudPlugin)
  }
}

function incompatibleGatsbyCloudPlugin(plugins: Array<IPluginInfo>): boolean {
  const plugin = plugins.find(
    plugin => plugin.name === GATSBY_CLOUD_PLUGIN_NAME
  )

  return !semver.satisfies(plugin!.version, `>=4.0.0-alpha`, {
    includePrerelease: true,
  })
}

export async function loadInternalPlugins(
  config: ISiteConfig = {},
  rootDir: string
): Promise<Array<IPluginInfo>> {
  // Instantiate plugins.
  const plugins: Array<IPluginInfo> = []
  const configuredPluginNames = new Set()

  // Add internal plugins
  const internalPluginPaths = [
    `../../internal-plugins/dev-404-page`,
    `../../internal-plugins/load-babel-config`,
    `../../internal-plugins/internal-data-bridge`,
    `../../internal-plugins/prod-404-500`,
    `../../internal-plugins/webpack-theme-component-shadowing`,
    `../../internal-plugins/bundle-optimisations`,
    `../../internal-plugins/functions`,
  ].filter(Boolean) as Array<string>

  for (const internalPluginPath of internalPluginPaths) {
    const internalPluginAbsolutePath = path.join(__dirname, internalPluginPath)
    const processedPlugin = await processPlugin(internalPluginAbsolutePath)
    plugins.push(processedPlugin)
  }

  // Add plugins from the site config.
  if (config.plugins) {
    for (const plugin of config.plugins) {
      const processedPlugin = await processPlugin(plugin)
      plugins.push(processedPlugin)
      configuredPluginNames.add(processedPlugin.name)
    }
  }

  // the order of all of these page-creators matters. The "last plugin wins",
  // so the user's site comes last, and each page-creator instance has to
  // match the plugin definition order before that. This works fine for themes
  // because themes have already been added in the proper order to the plugins
  // array
  for (const plugin of plugins) {
    const processedPlugin = await processPlugin({
      resolve: require.resolve(`gatsby-plugin-page-creator`),
      options: {
        path: slash(path.join(plugin.resolve, `src/pages`)),
        pathCheck: false,
      },
    })

    plugins.push(processedPlugin)
  }

  if (
    _CFLAGS_.GATSBY_MAJOR === `4` &&
    configuredPluginNames.has(GATSBY_CLOUD_PLUGIN_NAME) &&
    incompatibleGatsbyCloudPlugin(plugins)
  ) {
    reporter.panic(
      `Plugin gatsby-plugin-gatsby-cloud is not compatible with your gatsby version. Please upgrade to gatsby-plugin-gatsby-cloud@next`
    )
  }

  if (
    !configuredPluginNames.has(GATSBY_CLOUD_PLUGIN_NAME) &&
    (process.env.GATSBY_CLOUD === `true` || process.env.GATSBY_CLOUD === `1`)
  ) {
    await addGatsbyPluginCloudPluginWhenInstalled(
      plugins,
      processPlugin,
      rootDir
    )
  }

  // Support Typescript by default but allow users to override it
  if (!configuredPluginNames.has(TYPESCRIPT_PLUGIN_NAME)) {
    const processedTypeScriptPlugin = await processPlugin({
      resolve: require.resolve(TYPESCRIPT_PLUGIN_NAME),
      options: {
        // TODO(@mxstbr): Do not hard-code these defaults but infer them from the
        // pluginOptionsSchema of gatsby-plugin-typescript
        allExtensions: false,
        isTSX: false,
        jsxPragma: `React`,
      },
    })
    plugins.push(processedTypeScriptPlugin)
  }

  // Add the site's default "plugin" i.e. gatsby-x files in root of site.
  const compiledPath = `${path.join(process.cwd(), COMPILED_CACHE_DIR)}`
  plugins.push({
    resolve: slash(compiledPath),
    id: createPluginId(`default-site-plugin`),
    name: `default-site-plugin`,
    version: createFileContentHash(compiledPath, `gatsby-*`),
    pluginOptions: {
      plugins: [],
    },
  })

  const program = store.getState().program

  // default options for gatsby-plugin-page-creator
  let pageCreatorOptions: IPluginRefOptions | undefined = {
    path: slash(path.join(program.directory, `src/pages`)),
    pathCheck: false,
  }

  if (config.plugins) {
    const pageCreatorPlugin = config.plugins.find(
      (plugin): plugin is IPluginRefObject =>
        typeof plugin !== `string` &&
        plugin.resolve === `gatsby-plugin-page-creator` &&
        slash((plugin.options && plugin.options.path) || ``) ===
          slash(path.join(program.directory, `src/pages`))
    )
    if (pageCreatorPlugin) {
      // override the options if there are any user specified options
      pageCreatorOptions = pageCreatorPlugin.options
    }
  }

  const processedPageCreatorPlugin = await processPlugin({
    resolve: require.resolve(`gatsby-plugin-page-creator`),
    options: pageCreatorOptions,
  })

  plugins.push(processedPageCreatorPlugin)

  return plugins
}
