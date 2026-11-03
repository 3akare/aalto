/**
 * Build the downloadable extension zip the site links to, from extension/.
 *
 * It used to be zipped by hand, which meant the download quietly lagged behind
 * the source - the zip served on the site still had bugs fixed weeks earlier.
 *
 * `--check` builds nothing and fails if the served zip's contents differ from
 * extension/. It compares contents, not bytes: a zip records timestamps, so two
 * builds of identical files are never byte-identical.
 *
 * Uses the system `zip` and `unzip`, present on macOS and CI runners, rather
 * than a dependency for something this small.
 */

import { execFileSync } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "extension");
const { version } = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
const zipPath = join(root, "web", "public", "assets", `aalto-${version}.zip`);
const check = process.argv.includes("--check");

/** Every file the extension ships, relative to extension/, sorted. */
async function shippedFiles(dir = source) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .DS_Store and friends
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await shippedFiles(path)));
    else out.push(relative(source, path));
  }
  return out.sort();
}

const files = await shippedFiles();

if (check) {
  const listed = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.endsWith("/"))
    .sort();
  const problems = [];
  for (const f of files.filter((f) => !listed.includes(f))) problems.push(`missing: ${f}`);
  for (const f of listed.filter((f) => !files.includes(f))) problems.push(`extra: ${f}`);
  for (const f of files.filter((f) => listed.includes(f))) {
    const zipped = execFileSync("unzip", ["-p", zipPath, f], { maxBuffer: 64 << 20 });
    if (!zipped.equals(await readFile(join(source, f)))) problems.push(`stale: ${f}`);
  }
  if (problems.length > 0) {
    console.error(
      `${relative(root, zipPath)} is out of date - run \`npm run package\`:\n  ${problems.join("\n  ")}`
    );
    process.exit(1);
  }
  console.log(`${relative(root, zipPath)} matches extension/ (${files.length} files)`);
} else {
  await rm(zipPath, { force: true });
  // -X: no extra file attributes (owner ids, extended attributes) in the archive.
  execFileSync("zip", ["-X", "-q", "-9", zipPath, ...files], { cwd: source });
  console.log(`packaged ${files.length} files -> ${relative(root, zipPath)}`);
}
