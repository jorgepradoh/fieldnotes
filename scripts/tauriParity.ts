/**
 * The Tauri CLI refuses to build when an npm `@tauri-apps/*` package and the
 * Rust crate it talks to are on different minor versions (npm `api` 2.12 with
 * crate `tauri` 2.11, say). Lockfiles drift apart because npm and cargo are
 * updated separately, so this compares the two lockfiles.
 *
 *   @tauri-apps/api       <-> tauri
 *   @tauri-apps/plugin-X  <-> tauri-plugin-X
 *
 * `checkParity` is pure (it takes file contents) so the unit tests use inline
 * fixtures and never read the real lockfiles. Run from the command line it
 * reads package-lock.json and src-tauri/Cargo.lock, or the two paths given as
 * arguments, and exits 1 on any problem. Node runs it by stripping the types,
 * so keep it to erasable syntax: no enums, no parameter properties.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface ParityRow {
  npmPackage: string;
  crate: string;
  npmVersion: string;
  crateVersions: string[];
  ok: boolean;
}

export interface ParityReport {
  ok: boolean;
  rows: ParityRow[];
  errors: string[];
}

const CORE_PACKAGE = "@tauri-apps/api";

function majorMinor(version: string): string | null {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version);
  return match ? `${match[1]}.${match[2]}` : null;
}

/** The crate that pairs with an npm package, or null for packages with none (the CLI and its binaries). */
function crateFor(npmPackage: string): string | null {
  if (npmPackage === CORE_PACKAGE) return "tauri";
  const plugin = /^@tauri-apps\/plugin-(.+)$/.exec(npmPackage);
  return plugin ? `tauri-plugin-${plugin[1]}` : null;
}

/** name -> version for the top-level `@tauri-apps/*` packages of an npm lockfile. */
export function parsePackageLock(text: string): Map<string, string> {
  let lock: unknown;
  try {
    lock = JSON.parse(text);
  } catch {
    throw new Error("package-lock.json is not valid JSON.");
  }
  const packages = (lock as { packages?: unknown } | null)?.packages;
  if (typeof packages !== "object" || packages === null) {
    throw new Error("package-lock.json has no \"packages\" table (lockfileVersion 2 or 3 expected).");
  }
  const found = new Map<string, string>();
  for (const [path, entry] of Object.entries(packages)) {
    const name = /^node_modules\/(@tauri-apps\/[^/]+)$/.exec(path)?.[1];
    const version = (entry as { version?: unknown } | null)?.version;
    if (name && typeof version === "string") found.set(name, version);
  }
  return found;
}

/** crate name -> every version of it in a Cargo.lock. */
export function parseCargoLock(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    found.set(name, [...(found.get(name) ?? []), version]);
  }
  return found;
}

export function checkParity(packageLockText: string, cargoLockText: string): ParityReport {
  const npm = parsePackageLock(packageLockText);
  const crates = parseCargoLock(cargoLockText);
  const errors: string[] = [];
  const rows: ParityRow[] = [];

  // A lockfile we could not read must not read as "nothing to disagree about".
  if (crates.size === 0) errors.push("Cargo.lock lists no packages.");
  if (!npm.has(CORE_PACKAGE)) errors.push(`package-lock.json does not contain ${CORE_PACKAGE}.`);

  for (const [npmPackage, npmVersion] of [...npm].sort(([a], [b]) => a.localeCompare(b))) {
    const crate = crateFor(npmPackage);
    if (!crate) continue;
    const crateVersions = crates.get(crate) ?? [];
    let ok = false;
    if (crateVersions.length === 0) {
      errors.push(`${npmPackage} ${npmVersion} has no matching crate "${crate}" in Cargo.lock.`);
    } else if (crateVersions.length > 1) {
      errors.push(`Cargo.lock has several versions of "${crate}" (${crateVersions.join(", ")}); check by hand.`);
    } else if (majorMinor(npmVersion) === null || majorMinor(crateVersions[0]) === null) {
      errors.push(`Cannot read a version for ${npmPackage} (${npmVersion}) or ${crate} (${crateVersions[0]}).`);
    } else if (majorMinor(npmVersion) !== majorMinor(crateVersions[0])) {
      errors.push(
        `${npmPackage} ${npmVersion} does not match crate ${crate} ${crateVersions[0]}: ` +
          `the major.minor versions must be equal. Update the crate with ` +
          `"cargo update -p ${crate}" in src-tauri, or the npm package to match.`,
      );
    } else {
      ok = true;
    }
    rows.push({ npmPackage, crate, npmVersion, crateVersions, ok });
  }

  return { ok: errors.length === 0, rows, errors };
}

export function formatReport(report: ParityReport): string {
  const lines = report.rows.map(
    (r) => `${r.ok ? "ok  " : "FAIL"}  ${r.npmPackage} ${r.npmVersion}  <->  ${r.crate} ${r.crateVersions.join(", ") || "(missing)"}`,
  );
  for (const error of report.errors) lines.push(`error: ${error}`);
  return lines.join("\n");
}

function main(args: string[]): number {
  const read = (path: string | URL): string => {
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      throw new Error(`Cannot read ${String(path)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  try {
    const packageLock = read(args[0] ?? new URL("../package-lock.json", import.meta.url));
    const cargoLock = read(args[1] ?? new URL("../src-tauri/Cargo.lock", import.meta.url));
    const report = checkParity(packageLock, cargoLock);
    process.stdout.write(`${formatReport(report)}\n`);
    return report.ok ? 0 : 1;
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
