import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const shared = JSON.parse(await readFile(new URL("../../shared/package.json", import.meta.url), "utf8"));
const result = await build({
  entryPoints: ["src/api/server.ts"], outfile: "dist/api.cjs",
  bundle: true, platform: "node", target: "node22", format: "cjs",
  external: [...Object.keys(pkg.dependencies), ...Object.keys(shared.dependencies)]
    .filter(name => name !== "@movenrun/shared"),
  metafile: true, sourcemap: false,
});
// Keep the source graph available for the deployment isolation check.
const inputs = Object.keys(result.metafile.inputs);
if (inputs.some(path => /(?:src\/(?:workers|routes|blockchain)\/)/.test(path))) {
  throw new Error("Legacy runtime dependency entered the V3 API bundle");
}
await writeFile("dist/api-inputs.json", JSON.stringify(inputs, null, 2));
