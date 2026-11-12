// react-native.config.js: autolinking overrides for the paygent app.
// react-native-hce is Android-only (Apple does not allow tag emulation), so its iOS pod is not linked;
// src/lib/nfc.ts only requires it on Android.
module.exports = {
  dependencies: {
    "react-native-hce": { platforms: { ios: null } },
  },
};
