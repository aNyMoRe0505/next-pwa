import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTSConfig, logger } from "@ducanh2912/utils";
import { CleanWebpackPlugin } from "clean-webpack-plugin";
import fg from "fast-glob";
import type { NextConfig } from "next";
import type NextConfigShared from "next/dist/server/config-shared.js";
import type { Configuration, default as Webpack } from "webpack";

import defaultCache from "./cache.js";
import { resolveWorkboxCommon } from "./resolve-workbox-common.js";
import { resolveWorkboxPlugin } from "./resolve-workbox-plugin.js";
import type { PluginOptions } from "./types.js";
import { getFileHash } from "./utils.js";
import { buildCustomWorker } from "./webpack-builders/build-custom-worker.js";
import { setDefaultContext } from "./webpack-builders/context.js";
import {
  buildFallbackWorker,
  buildSWEntryWorker,
  getDefaultDocumentPage,
} from "./webpack-builders/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const withPWAInit = (
  pluginOptions: PluginOptions = {}
): ((nextConfig?: NextConfig) => NextConfig) => {
  return (nextConfig = {}) => ({
    ...nextConfig,
    webpack(config: Configuration, options) {
      let nextDefConfig: NextConfig | undefined;

      try {
        nextDefConfig = (
          require("next/dist/server/config-shared") as typeof NextConfigShared
        ).defaultConfig;
      } catch {
        // do nothing - we are using Next's internals.
      }

      const isAppDirEnabled =
        nextConfig.experimental?.appDir ??
        nextDefConfig?.experimental?.appDir ??
        true;

      const webpack: typeof Webpack = options.webpack;
      const {
        buildId,
        dev,
        config: {
          distDir = ".next",
          pageExtensions = ["tsx", "ts", "jsx", "js", "mdx"],
        },
      } = options;

      const basePath = options.config.basePath || "/";

      const tsConfigJSON = loadTSConfig(
        options.dir,
        nextConfig?.typescript?.tsconfigPath
      );

      // For Workbox configurations:
      // https://developers.google.com/web/tools/workbox/reference-docs/latest/module-workbox-webpack-plugin.GenerateSW
      const {
        disable = false,
        register = true,
        dest = distDir,
        sw = "sw.js",
        cacheStartUrl = true,
        dynamicStartUrl = true,
        dynamicStartUrlRedirect,
        publicExcludes = ["!noprecache/**/*"],
        buildExcludes = [],
        fallbacks = {},
        cacheOnFrontEndNav = false,
        aggressiveFrontEndNavCaching = false,
        reloadOnOnline = true,
        scope = basePath,
        customWorkerDir = "worker",
        customWorkerSrc = customWorkerDir,
        customWorkerDest = dest,
        customWorkerPrefix = "worker",
        workboxOptions = {},
        extendDefaultRuntimeCaching = false,
        swcMinify = nextConfig.swcMinify ?? nextDefConfig?.swcMinify ?? false,
      } = pluginOptions;

      if (typeof nextConfig.webpack === "function") {
        config = nextConfig.webpack(config, options);
      }

      if (disable) {
        options.isServer && logger.info("PWA support is disabled.");
        return config;
      }

      const importScripts: string[] = [];

      if (!config.plugins) {
        config.plugins = [];
      }

      logger.info(
        `Compiling for ${options.isServer ? "server" : "client (static)"}...`
      );

      const requiredUrls: string[] = [];

      const _sw = path.posix.join(basePath, sw);
      const _scope = path.posix.join(scope, "/");

      requiredUrls.push(_sw);

      config.plugins.push(
        new webpack.DefinePlugin({
          __PWA_SW__: `'${_sw}'`,
          __PWA_SCOPE__: `'${_scope}'`,
          __PWA_ENABLE_REGISTER__: `${Boolean(register)}`,
          __PWA_START_URL__: dynamicStartUrl ? `'${basePath}'` : undefined,
          __PWA_CACHE_ON_FRONT_END_NAV__: `${Boolean(cacheOnFrontEndNav)}`,
          __PWA_AGGRFEN_CACHE__: `${Boolean(aggressiveFrontEndNavCaching)}`,
          __PWA_RELOAD_ON_ONLINE__: `${Boolean(reloadOnOnline)}`,
        })
      );

      const swEntryJs = path.join(__dirname, "sw-entry.js");
      const entry = config.entry as () => Promise<
        Record<string, string[] | string>
      >;
      config.entry = () =>
        entry().then((entries) => {
          if (entries["main.js"] && !entries["main.js"].includes(swEntryJs)) {
            if (Array.isArray(entries["main.js"])) {
              entries["main.js"].unshift(swEntryJs);
            } else if (typeof entries["main.js"] === "string") {
              entries["main.js"] = [swEntryJs, entries["main.js"]];
            }
          }
          if (entries["main-app"] && !entries["main-app"].includes(swEntryJs)) {
            if (Array.isArray(entries["main-app"])) {
              entries["main-app"].unshift(swEntryJs);
            } else if (typeof entries["main-app"] === "string") {
              entries["main-app"] = [swEntryJs, entries["main-app"]];
            }
          }
          return entries;
        });

      if (!options.isServer) {
        setDefaultContext("shouldMinify", !dev);
        setDefaultContext("useSwcMinify", swcMinify);

        const _dest = path.join(options.dir, dest);
        const _cwdest = path.join(options.dir, customWorkerDest);
        const sweWorkerPath = buildSWEntryWorker({
          isDev: dev,
          destDir: _dest,
          shouldGenSWEWorker: cacheOnFrontEndNav,
          basePath,
        });

        config.plugins.push(
          new webpack.DefinePlugin({
            __PWA_SW_ENTRY_WORKER__:
              sweWorkerPath &&
              (requiredUrls.push(sweWorkerPath), `'${sweWorkerPath}'`),
          })
        );

        if (!register) {
          logger.info(
            "Service worker won't be automatically registered as per the config, please call the following code in componentDidMount or useEffect:"
          );

          logger.info(`  window.workbox.register()`);

          if (
            !tsConfigJSON?.compilerOptions?.types?.includes(
              "@ducanh2912/next-pwa/workbox"
            )
          ) {
            logger.info(
              "You may also want to add @ducanh2912/next-pwa/workbox to compilerOptions.types in your tsconfig.json/jsconfig.json."
            );
          }
        }

        logger.info(`Service worker: ${path.join(_dest, sw)}`);
        logger.info(`  URL: ${_sw}`);
        logger.info(`  Scope: ${_scope}`);

        config.plugins.push(
          new CleanWebpackPlugin({
            cleanOnceBeforeBuildPatterns: [
              path.join(_dest, "workbox-*.js"),
              path.join(_dest, "workbox-*.js.map"),
              path.join(_dest, sw),
              path.join(_dest, `${sw}.map`),
              path.join(_dest, "sw-chunks/**"),
            ],
          })
        );

        const customWorkerScriptName = buildCustomWorker({
          isDev: dev,
          baseDir: options.dir,
          swDest: _dest,
          customWorkerSrc,
          customWorkerDest: _cwdest,
          customWorkerPrefix,
          plugins: config.plugins.filter(
            (plugin) => plugin instanceof webpack.DefinePlugin
          ),
          tsconfig: tsConfigJSON,
          basePath,
        });

        if (!!customWorkerScriptName) {
          importScripts.unshift(customWorkerScriptName);
          requiredUrls.push(customWorkerScriptName);
        }

        const {
          additionalManifestEntries,
          modifyURLPrefix = {},
          manifestTransforms = [],
          // @ts-expect-error removed from types
          exclude,
          ...workbox
        } = workboxOptions;

        // Precache files in public folder
        let manifestEntries = additionalManifestEntries ?? [];

        if (!manifestEntries) {
          manifestEntries = fg
            .sync(
              [
                "**/*",
                "!workbox-*.js",
                "!workbox-*.js.map",
                "!worker-*.js",
                "!worker-*.js.map",
                "!fallback-*.js",
                "!fallback-*.js.map",
                `!${sw.replace(/^\/+/, "")}`,
                `!${sw.replace(/^\/+/, "")}.map`,
                ...publicExcludes,
              ],
              {
                cwd: "public",
              }
            )
            .map((f) => ({
              url: path.posix.join(basePath, f),
              revision: getFileHash(`public/${f}`),
            }));
        }

        if (cacheStartUrl) {
          if (!dynamicStartUrl) {
            manifestEntries.push({
              url: basePath,
              revision: buildId,
            });
          } else if (
            typeof dynamicStartUrlRedirect === "string" &&
            dynamicStartUrlRedirect.length > 0
          ) {
            manifestEntries.push({
              url: dynamicStartUrlRedirect,
              revision: buildId,
            });
          }
        }

        Object.keys(workbox).forEach(
          (key) => workbox[key] === undefined && delete workbox[key]
        );

        let hasFallbacks = false;

        if (fallbacks) {
          if (!fallbacks.document) {
            fallbacks.document = getDefaultDocumentPage(
              options.dir,
              pageExtensions,
              isAppDirEnabled
            );
          }
          const fallbackWorker = buildFallbackWorker({
            isDev: dev,
            buildId,
            fallbacks,
            destDir: _dest,
            basePath,
          });

          if (fallbackWorker) {
            hasFallbacks = true;
            importScripts.unshift(fallbackWorker.name);
            requiredUrls.push(fallbackWorker.name);

            fallbackWorker.precaches.forEach((route) => {
              if (
                route &&
                typeof route !== "boolean" &&
                !manifestEntries.find(
                  (entry) =>
                    typeof entry !== "string" && entry.url.startsWith(route)
                )
              ) {
                manifestEntries.push({
                  url: route,
                  revision: buildId,
                });
              }
            });
          }
        }

        const workboxCommon = resolveWorkboxCommon({
          dest: _dest,
          sw,
          dev,
          buildId,
          buildExcludes,
          manifestEntries,
          manifestTransforms,
          modifyURLPrefix,
          publicPath: config.output?.publicPath,
        });

        const workboxPlugin = resolveWorkboxPlugin({
          rootDir: options.dir,
          basePath,
          isDev: dev,

          workboxCommon,
          workboxOptions: workbox,
          importScripts,

          extendDefaultRuntimeCaching,
          dynamicStartUrl,

          hasFallbacks,
        });

        config.plugins.push(workboxPlugin);

        if (_dest !== path.join(options.dir, "public")) {
          logger.info(
            `Successfully built the service worker. ${requiredUrls.join(
              ", "
            )} ${
              requiredUrls.length === 1 ? "is" : "are"
            } expected to be manually served.`
          );
        }
      }

      return config;
    },
  });
};

export default withPWAInit;
export { defaultCache as runtimeCaching };
export * from "./types.js";
