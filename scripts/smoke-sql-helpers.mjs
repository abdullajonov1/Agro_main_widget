/**
 * Smoke asserts against the REAL production helpers in src/data/agri-sql.ts
 * (transpiled in-process). Run from widget root:
 *   node scripts/smoke-sql-helpers.mjs
 *
 * Covers F-05 / F-12 (agri-sql) without requiring the ExB jest harness.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetRoot = path.resolve(__dirname, "..");
const agriSqlPath = path.join(widgetRoot, "src", "data", "agri-sql.ts");
const clientRoot = path.resolve(widgetRoot, "..", "..", "..", "..");
const require = createRequire(path.join(clientRoot, "package.json"));
const ts = require("typescript");

const source = fs.readFileSync(agriSqlPath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: "agri-sql.ts",
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agri-sql-smoke-"));
const tmpFile = path.join(tmpDir, "agri-sql.mjs");
fs.writeFileSync(tmpFile, outputText, "utf8");

const mod = await import(pathToFileURL(tmpFile).href);
const {
  escapeLikeLiteral,
  dateEqualsClause,
  escapeArcGIS,
  sanitizeLikeInput,
  normalizeApos,
  eqAposSmart,
  buildTumanEqualsSql,
} = mod;

assert.equal(typeof escapeLikeLiteral, "function");
assert.equal(typeof dateEqualsClause, "function");
assert.equal(typeof escapeArcGIS, "function");
assert.equal(typeof sanitizeLikeInput, "function");
assert.equal(typeof normalizeApos, "function");
assert.equal(typeof eqAposSmart, "function");
assert.equal(typeof buildTumanEqualsSql, "function");

assert.equal(escapeLikeLiteral("%"), "");
assert.equal(escapeLikeLiteral("_"), "");
assert.equal(escapeLikeLiteral("a'b"), "a''b");
assert.equal(escapeLikeLiteral("100%x"), "100x");
assert.equal(escapeLikeLiteral("2024"), "2024");

const yearLike = `yil LIKE '${escapeLikeLiteral("2024")}%'`;
assert.ok(!yearLike.includes("ESCAPE"));
assert.equal(yearLike, "yil LIKE '2024%'");

assert.equal(
  dateEqualsClause("raster_date", "2024-01-01"),
  "raster_date >= DATE '2024-01-01' AND raster_date < DATE '2024-01-02'",
);
assert.equal(dateEqualsClause("raster_date", "2024-01-01' OR '1'='1"), "1=0");
assert.equal(dateEqualsClause("raster_date;drop", "2024-01-01"), "1=0");

// normalizeApos — Yakkabog‘ (U+2018) and modifier letter apostrophes
assert.equal(normalizeApos("Yakkabog\u2018"), "Yakkabog'");
assert.equal(normalizeApos("Farg\u02BBona"), "Farg'ona");
assert.equal(normalizeApos("  trim  "), "  trim  "); // no trim in shared helper

assert.equal(eqAposSmart("viloyat", ""), "");
assert.equal(eqAposSmart("viloyat", "Toshkent"), "viloyat='Toshkent'");
assert.ok(eqAposSmart("viloyat", "Farg'ona").includes(" OR "));

const tumanSql = buildTumanEqualsSql("tuman", "Yakkabog'");
assert.ok(tumanSql.includes("tuman="));
assert.ok(!tumanSql.includes("ESCAPE"));
// Must stay compact — no cartesian apostrophe × suffix explosion
assert.ok(tumanSql.length < 800, `tuman SQL too large: ${tumanSql.length}`);

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log("smoke-sql-helpers: OK (bound to src/data/agri-sql.ts)");
console.log("widgetRoot:", widgetRoot);
