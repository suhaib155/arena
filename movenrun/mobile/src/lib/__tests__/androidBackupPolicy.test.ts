/**
 * Android backup and device-transfer guards: offline, structural, no device.
 *
 * Unsent sessions keep their precise GPS route on the phone until the server
 * accepts them, so no app data may leave the phone through Android backup or
 * a device-to-device transfer. `allowBackup: false` covers cloud backup and
 * Android 11 and below; Android 12 and above ignore it for device transfer,
 * which `plugins/withNoBackupTransfer.js` covers with `dataExtractionRules`.
 * The merged manifest of a real build and a handset transfer are checked
 * separately (see the device gate plan).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const MOBILE = process.cwd();
const require = createRequire(join(MOBILE, "package.json"));
const plugin = require("./plugins/withNoBackupTransfer.js") as {
  RULES_XML: string;
  DOMAINS: string[];
  setDataExtractionRules: (manifest: any) => any;
};

function appConfig(): Record<string, any> {
  return JSON.parse(readFileSync(join(MOBILE, "app.json"), "utf8")).expo;
}

test("app.json turns Android backup off", () => {
  assert.equal(appConfig().android.allowBackup, false);
});

test("app.json applies the no-transfer plugin", () => {
  assert.ok((appConfig().plugins as unknown[]).includes("./plugins/withNoBackupTransfer"));
});

test("the rules exclude every domain from cloud backup and from device transfer", () => {
  const expected = [
    "root", "file", "database", "sharedpref", "external",
    "device_root", "device_file", "device_database", "device_sharedpref",
  ];
  assert.deepEqual([...plugin.DOMAINS].sort(), [...expected].sort());
  for (const tag of ["cloud-backup", "device-transfer"]) {
    const body = plugin.RULES_XML.split(`<${tag}>`)[1]?.split(`</${tag}>`)[0];
    assert.ok(body, `${tag} section present`);
    for (const domain of expected) {
      assert.match(body, new RegExp(`<exclude domain="${domain}" path="\\." />`), `${tag} excludes ${domain}`);
    }
    assert.doesNotMatch(body, /<include/, `${tag} includes nothing`);
  }
});

test("the manifest's application points at the rules file", () => {
  const manifest = { manifest: { application: [{ $: { "android:name": ".MainApplication" } }] } };
  const out = plugin.setDataExtractionRules(manifest);
  assert.equal(out.manifest.application[0].$["android:dataExtractionRules"], "@xml/data_extraction_rules");
});
