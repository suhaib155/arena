/**
 * Keep the app's data out of Android backup and device-to-device transfer.
 *
 * Unsent movement sessions sit in AsyncStorage with their precise GPS route
 * until the server accepts them. `android.allowBackup: false` in `app.json`
 * stops cloud backup and, up to Android 11, device transfer. From Android 12
 * a device-to-device transfer ignores `allowBackup`, so this plugin also adds
 * `android:dataExtractionRules` with every domain excluded from both cloud
 * backup and device transfer.
 *
 * The cost: on a new or reset phone the app starts signed out with no local
 * progress or unsent sessions. Anything the server has accepted comes back on
 * sign-in. `src/lib/__tests__/androidBackupPolicy.test.ts` checks both settings.
 */
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const RULES_NAME = "data_extraction_rules";

/** Every storage domain an app can have (device_* is device-protected storage). */
const DOMAINS = [
  "root", "file", "database", "sharedpref", "external",
  "device_root", "device_file", "device_database", "device_sharedpref",
];

function section(tag) {
  const lines = DOMAINS.map((domain) => `        <exclude domain="${domain}" path="." />`);
  return [`    <${tag}>`, ...lines, `    </${tag}>`].join("\n");
}

const RULES_XML = [
  '<?xml version="1.0" encoding="utf-8"?>',
  "<data-extraction-rules>",
  section("cloud-backup"),
  section("device-transfer"),
  "</data-extraction-rules>",
  "",
].join("\n");

/** Point the manifest's application at the rules file. */
function setDataExtractionRules(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  app.$["android:dataExtractionRules"] = `@xml/${RULES_NAME}`;
  return manifest;
}

function withNoBackupTransfer(config) {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = setDataExtractionRules(mod.modResults);
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${RULES_NAME}.xml`), RULES_XML);
      return mod;
    },
  ]);
}

module.exports = withNoBackupTransfer;
module.exports.RULES_XML = RULES_XML;
module.exports.DOMAINS = DOMAINS;
module.exports.setDataExtractionRules = setDataExtractionRules;
