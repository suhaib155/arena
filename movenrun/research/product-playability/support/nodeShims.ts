/**
 * Plain-Node stand-ins for the two native modules the game store and the retry
 * queue reach at import time. Loaded with `--import` before any test module.
 *
 * AsyncStorage becomes an in-memory map (inspectable through
 * `globalThis.__asyncStorage`), and `react-native` resolves to an empty
 * object. Nothing else is replaced: every app module under test is the real one.
 */
import Module from "node:module";
import { join } from "node:path";

const memory = new Map<string, string>();
(globalThis as { __asyncStorage?: Map<string, string> }).__asyncStorage = memory;
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const STUBS: Record<string, string> = {
  "@react-native-async-storage/async-storage": join(__dirname, "asyncStorageStub.js"),
  "react-native": join(__dirname, "reactNativeStub.js"),
};

const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const original = resolver._resolveFilename;
resolver._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request in STUBS) return STUBS[request]!;
  return original.call(this, request, ...rest);
};
