// metro.config.js: Expo's default Metro config plus the repo's shared/ folder, so the app imports
// the same money/currency/types code as the server and web app (via the @shared/* tsconfig alias)
// instead of keeping a copy.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../shared")];
// The @shared/* and @/* aliases are resolved by Expo's tsconfigPaths (app.config.ts experiments);
// files in ../shared resolve any package (Babel helpers) from mobile/node_modules only.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
config.resolver.extraNodeModules = new Proxy(
  {},
  { get: (_, name) => path.resolve(__dirname, "node_modules", String(name)) },
);

module.exports = config;
