// plugins/with-hce.js: Expo config plugin for Android Host Card Emulation (react-native-hce) — adds
// the NFC permission, the optional HCE feature, the CardService and res/xml/aid_list.xml with the
// NFC Forum Type 4 tag AID (D2760000850101). iOS is untouched: Apple does not allow tag emulation.
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require("expo/config-plugins");

const AID = "D2760000850101";
const SERVICE = "com.reactnativehce.services.CardService";

const AID_XML = `<?xml version="1.0" encoding="utf-8"?>
<host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/app_name"
    android:requireDeviceUnlock="false">
  <aid-group android:category="other" android:description="@string/app_name">
    <aid-filter android:name="${AID}" />
  </aid-group>
</host-apdu-service>
`;

function withHceManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    AndroidConfig.Permissions.ensurePermission(cfg.modResults, "android.permission.NFC");
    manifest["uses-feature"] = manifest["uses-feature"] ?? [];
    if (!manifest["uses-feature"].some((f) => f.$["android:name"] === "android.hardware.nfc.hce")) {
      // Not required: phones without HCE still install the app and use the sticker/QR instead.
      manifest["uses-feature"].push({
        $: { "android:name": "android.hardware.nfc.hce", "android:required": "false" },
      });
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({
      $: {
        "android:name": SERVICE,
        "android:exported": "true",
        "android:enabled": "false",
        "android:permission": "android.permission.BIND_NFC_SERVICE",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "android.nfc.cardemulation.action.HOST_APDU_SERVICE" } }],
          category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
        },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.nfc.cardemulation.host_apdu_service",
            "android:resource": "@xml/aid_list",
          },
        },
      ],
    });
    return cfg;
  });
}

function withAidList(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "aid_list.xml"), AID_XML);
      return cfg;
    },
  ]);
}

module.exports = function withHce(config) {
  return withAidList(withHceManifest(config));
};
