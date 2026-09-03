/**
 * Load one real h3-js artifact in a cold process whose `TextDecoder` behaves
 * like Hermes', and exercise the H3 functions the app actually calls.
 *
 * This runs as a **child process**, which is not incidental. The failure it
 * guards against happens once, during module initialisation, on the first
 * `require`. A test in the parent process would see a module the runner had
 * already initialised under Node's own TextDecoder and would prove nothing.
 * One process per artifact is the only way to observe a cold start.
 *
 * Nothing here is mocked. The file named on argv is the same file the bundler
 * resolves, and every value printed comes from the real H3 library running on
 * its real Emscripten runtime.
 *
 * Usage:   node hermesH3Probe.cjs <absolute path to an h3-js artifact>
 * Output:  one line of JSON on stdout; exit 0 on success, 1 on failure.
 */

/* ── the Hermes model ─────────────────────────────────────────────────────── */

/**
 * Hermes ships a `TextDecoder` that supports UTF-8 and nothing else, and
 * rejects any other label with a `RangeError`. The message shape below is the
 * one a physical Android device produced against the unpatched dependency:
 *
 *     RangeError: Unknown encoding: utf-16le (normalized: utf-16le)
 *
 * The label set is deliberately a UTF-8 *allowlist* rather than a UTF-16
 * denylist. A denylist would model "Hermes dislikes UTF-16", which is not the
 * fact — the fact is that Hermes implements one encoding — and a denylist would
 * quietly pass a regression that reached for some third encoding instead.
 */
const UTF8_LABELS = new Set([
  "utf-8",
  "utf8",
  "unicode-1-1-utf-8",
  "unicode11utf8",
  "unicode20utf8",
  "x-unicode20utf8",
]);

const NativeTextDecoder = globalThis.TextDecoder;

function normalizeLabel(label) {
  return String(label).trim().toLowerCase().replace(/[\s_]/g, "-");
}

class HermesTextDecoder {
  constructor(label = "utf-8", options) {
    const normalized = normalizeLabel(label);
    if (!UTF8_LABELS.has(normalized)) {
      throw new RangeError(`Unknown encoding: ${label} (normalized: ${normalized})`);
    }
    return new NativeTextDecoder("utf-8", options);
  }
}

globalThis.TextDecoder = HermesTextDecoder;

/** What the model does with a label, as a plain reportable value. */
function probeLabel(label) {
  try {
    new globalThis.TextDecoder(label);
    return { accepted: true, message: null };
  } catch (error) {
    return { accepted: false, message: String(error && error.message) };
  }
}

/* ── the run ──────────────────────────────────────────────────────────────── */

const entry = process.argv[2];

const report = {
  ok: false,
  /* Split from `ok` on purpose. Initialising is what crashed on the device, and
     some shipped artifacts are the raw Emscripten runtime rather than the public
     H3 API — they can load correctly and still export no `latLngToCell`. */
  loaded: false,
  entry,
  /* Proof the model is live before anything is loaded. Without these two the
     whole probe could pass because the shim silently failed to install. */
  rejectsUtf16le: probeLabel("utf-16le"),
  /* h3-js still constructs a UTF-8 decoder, and must keep working. The device
     reached the UTF-16 line at all, which means it had already executed the
     UTF-8 construction earlier in the same file — so this is device-confirmed,
     not an assumption. */
  acceptsUtf8: probeLabel("utf8"),
};

try {
  if (!entry) throw new Error("no artifact path given");

  const h3 = require(entry);
  report.loaded = true;

  /* Not every shipped artifact is the public API. The ones that are not have
     already proven the only thing they can prove — that the module body ran. */
  if (typeof h3.latLngToCell !== "function") {
    report.publicApi = false;
    report.ok = true;
    process.stdout.write(JSON.stringify(report) + "\n");
    process.exit(0);
  }
  report.publicApi = true;

  /* Every call below moves an H3 index across the JS/WASM boundary as a
     string, which is the exact machinery the removed decoder belonged to.
     If the patch had damaged string marshalling, these are what would break. */
  const bengaluru = h3.latLngToCell(12.9716, 77.5946, 8);
  const sanFrancisco = h3.latLngToCell(37.7752, -122.4184, 9);
  const [centerLat, centerLng] = h3.cellToLatLng(bengaluru);

  report.bengaluruRes8 = bengaluru;
  report.sanFranciscoRes9 = sanFrancisco;
  report.resolution = h3.getResolution(bengaluru);
  report.isValid = h3.isValidCell(bengaluru);
  report.rejectsNonsense = h3.isValidCell("not-a-cell");
  report.centerLat = centerLat;
  report.centerLng = centerLng;
  report.boundaryVertices = h3.cellToBoundary(bengaluru).length;
  report.diskSize = h3.gridDisk(bengaluru, 1).length;
  report.diskContainsOrigin = h3.gridDisk(bengaluru, 1).includes(bengaluru);
  report.parentRes5 = h3.cellToParent(bengaluru, 5);
  report.pentagonCount = h3.getPentagons(0).length;
  report.ok = true;
} catch (error) {
  report.error = {
    name: error && error.constructor ? error.constructor.name : "Error",
    message: String(error && error.message),
  };
}

process.stdout.write(JSON.stringify(report) + "\n");
process.exit(report.ok ? 0 : 1);
