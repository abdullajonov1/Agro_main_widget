/**
 * Smoke for access-lock pure helpers (F-12 access lock).
 * Transpiles agri-access-config with a stub jimu-core so Node can import it.
 *   node scripts/smoke-access-lock.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetRoot = path.resolve(__dirname, "..");
const clientRoot = path.resolve(widgetRoot, "..", "..", "..", "..");
const require = createRequire(path.join(clientRoot, "package.json"));
const ts = require("typescript");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agri-access-smoke-"));

const stubJimu = path.join(tmpDir, "jimu-core.mjs");
fs.writeFileSync(
  stubJimu,
  `export const getAppStore = () => ({ getState: () => ({ user: null }) });\n`,
  "utf8",
);

function transpileTo(fileRel, outName) {
  const srcPath = path.join(widgetRoot, "src", ...fileRel.split("/"));
  const source = fs.readFileSync(srcPath, "utf8");
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: path.basename(srcPath),
  });
  // Rewrite relative imports to local transpiled siblings / stub.
  outputText = outputText
    .replace(
      /from\s+["']jimu-core["']/g,
      `from ${JSON.stringify(pathToFileURL(stubJimu).href)}`,
    )
    .replace(
      /from\s+["']\.\.\/data\/agri-sql["']/g,
      `from ${JSON.stringify(pathToFileURL(path.join(tmpDir, "agri-sql.mjs")).href)}`,
    );
  const out = path.join(tmpDir, outName);
  fs.writeFileSync(out, outputText, "utf8");
  return out;
}

transpileTo("data/agri-sql.ts", "agri-sql.mjs");
const accessOut = transpileTo("shared/agri-access-config.ts", "agri-access-config.mjs");

const mod = await import(pathToFileURL(accessOut).href);
const {
  resolveAllowedViloyatsForGroups,
  combineAccessWhere,
  setAccessConfig,
  getAccessWhere,
  isAccessDenied,
} = mod;

assert.equal(typeof resolveAllowedViloyatsForGroups, "function");
assert.equal(typeof combineAccessWhere, "function");

const emptyConfig = { fullAccessGroups: [], rules: [] };
assert.deepEqual(
  resolveAllowedViloyatsForGroups([{ id: "g1" }], emptyConfig),
  [],
);

const singleLock = {
  fullAccessGroups: [],
  rules: [
    {
      id: "r1",
      title: "Viloyat",
      field: "viloyat",
      rules: [
        {
          id: "a1",
          operator: "equal",
          value: "Farg'ona",
          groups: ["g1"],
        },
      ],
    },
  ],
};
const allowed = resolveAllowedViloyatsForGroups([{ id: "g1" }], singleLock);
assert.equal(allowed.length, 1);
assert.equal(allowed[0], "Farg'ona");

const multi = {
  fullAccessGroups: [],
  rules: [
    {
      id: "r1",
      title: "Viloyat",
      field: "viloyat",
      rules: [
        {
          id: "a1",
          operator: "include",
          values: ["Andijon", "Namangan"],
          groups: ["g1"],
        },
      ],
    },
  ],
};
assert.equal(
  resolveAllowedViloyatsForGroups([{ id: "g1" }], multi).length,
  2,
);

const full = {
  fullAccessGroups: ["admins"],
  rules: singleLock.rules,
};
assert.deepEqual(
  resolveAllowedViloyatsForGroups([{ id: "admins" }], full),
  [],
);

setAccessConfig(emptyConfig);
assert.equal(getAccessWhere(), "1=1");
assert.equal(isAccessDenied(), false);
assert.equal(combineAccessWhere("yil LIKE '2024%'"), "yil LIKE '2024%'");

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log("smoke-access-lock: OK");
console.log("widgetRoot:", widgetRoot);
