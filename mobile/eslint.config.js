// eslint.config.js: Expo's flat ESLint config for the mobile app (run with `npm run lint`).
// Generated native folders and build output are ignored.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig, { ignores: ["dist/*", "android/*", "ios/*", ".expo/*"] }]);
