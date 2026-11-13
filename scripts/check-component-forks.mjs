/*
 * Component fork drift guard (P0-1① + P1-1, 2026-11-12).
 *
 * The three consumer apps (workpaw-web, workpaw-desktop, workpaw-admin/console)
 * still carry copied shadcn components under their own src/components/ui/.
 * Until each fork is migrated back onto workpaw-ui, this guard pins their
 * content so they cannot drift SILENTLY:
 *
 *   - pair       = a file that exists with the same relative name in both the
 *                  consumer ui/ dir and the library src/components/ui/
 *   - fork       = a pair whose consumer copy differs from the library file
 *   - baseline   = scripts/component-forks-baseline.json, pinning each fork's
 *                  consumer sha256 (+ library sha256 + diff summary line count)
 *
 * Exit semantics (run plain, e.g. via `pnpm lint`):
 *   FAIL  pair whose consumer hash differs from the pinned baseline hash
 *         ("fork 又漂了：要么回流库要么更新基线并附理由")
 *   WARN  pair not yet in the baseline (new fork — record it, no failure)
 *   NOTE  baseline entry whose consumer file is gone or now byte-identical to
 *         the library ("已收敛，从基线移除") — never a failure
 *   SKIP  consumer checkout absent (CI only clones this repo) or no baseline
 *         yet (first run) — printed loudly, never a failure
 *
 * `--write-baseline` regenerates the baseline from the current tree. Update it
 * deliberately: a baseline change IS a decision and needs a reason in the PR.
 *
 * Run via `pnpm lint` / `pnpm check:forks` (or directly:
 * node scripts/check-component-forks.mjs).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const libraryDir = join(root, "src/components/ui");
const baselinePath = join(root, "scripts/component-forks-baseline.json");

/* Real consumer paths (confirmed on disk 2026-11-12; desktop keeps ui/ at
   src/components/ui like the others). Kept as sibling-checkout-relative paths:
   the workspace layout is <repo>/workpaw-* side by side. */
const CONSUMERS = [
  { id: "web", dir: "../workpaw-web/src/components/ui" },
  { id: "desktop", dir: "../workpaw-desktop/src/components/ui" },
  { id: "admin-console", dir: "../workpaw-admin/console/src/components/ui" },
];

const writeBaseline = process.argv.includes("--write-baseline");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/* Line count of a symmetric line diff (added + removed), LCS-based with
   prefix/suffix trimming. Falls back to a size-based estimate when the LCS
   matrix would explode (never expected for component files). */
function diffLineCount(aText, bText) {
  const a = aText.split("\n");
  const b = bText.split("\n");
  while (a.length && b.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  while (a.length && b.length && a[a.length - 1] === b[b.length - 1]) {
    a.pop();
    b.pop();
  }
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length * b.length > 9_000_000) {
    // Degenerate huge pair: report changed-side size instead of running LCS.
    return a.length + b.length;
  }
  // LCS table (b as rows, a as columns), rolling row for memory.
  let previous = new Array(a.length + 1).fill(0);
  for (let i = 1; i <= b.length; i += 1) {
    const current = [0];
    for (let j = 1; j <= a.length; j += 1) {
      current[j] =
        b[i - 1] === a[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  const common = previous[a.length];
  return a.length + b.length - 2 * common;
}

function listFiles(dir) {
  const names = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue; // ui/ forks are flat; skip subdirs
    names.push(entry.name);
  }
  return names.sort();
}

function scan() {
  if (!existsSync(libraryDir)) {
    console.error(`FAIL  library ui dir missing: ${relative(root, libraryDir)}`);
    process.exitCode = 1;
    return null;
  }
  const libraryNames = new Set(listFiles(libraryDir));
  const readLibrary = new Map();
  const libText = (name) => {
    if (!readLibrary.has(name))
      readLibrary.set(
        name,
        readFileSync(join(libraryDir, name), "utf8"),
      );
    return readLibrary.get(name);
  };

  const pairs = [];
  const skipped = [];
  for (const { id, dir } of CONSUMERS) {
    const consumerDir = resolve(root, dir);
    if (!existsSync(consumerDir)) {
      skipped.push(id);
      continue;
    }
    if (!statSync(consumerDir).isDirectory()) {
      skipped.push(id);
      continue;
    }
    for (const name of listFiles(consumerDir)) {
      if (!libraryNames.has(name)) continue; // consumer-only file: no pair
      pairs.push({
        key: `${id}/${name}`,
        consumerText: readFileSync(join(consumerDir, name), "utf8"),
        libraryText: libText(name),
      });
    }
  }
  return { pairs, skipped };
}

function main() {
  const scanned = scan();
  if (!scanned) return;
  const { pairs, skipped } = scanned;

  for (const id of skipped)
    console.log(
      `skip  consumer "${id}" not checked out next to this repo (CI clones workpaw-ui only) — fork assertions skipped for it`,
    );

  if (writeBaseline) {
    const forks = {};
    for (const pair of pairs) {
      const consumerHash = sha256(pair.consumerText);
      const libraryHash = sha256(pair.libraryText);
      if (consumerHash === libraryHash) continue; // mirror, not a fork
      forks[pair.key] = {
        hash: consumerHash,
        libHash: libraryHash,
        diffLines: diffLineCount(pair.consumerText, pair.libraryText),
      };
    }
    const baseline = {
      version: 1,
      note: "fork 漂移基线（P0-1①）。hash = 消费端副本文件的 sha256，libHash = 库内同名文件 sha256，diffLines = 与库文件的行级 diff 概要（+/- 行数）。更新基线 = 一次决策，必须附理由（fork 已回流库，或迁移拍板）。",
      generatedAt: new Date().toISOString(),
      forks,
    };
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `baseline written: ${pairs.length} same-name pair(s) scanned, ${Object.keys(forks).length} fork(s) pinned`,
    );
    return;
  }

  if (!existsSync(baselinePath)) {
    console.log(
      "skip  no baseline yet (scripts/component-forks-baseline.json) — run `node scripts/check-component-forks.mjs --write-baseline` once to pin the current forks; fork assertions skipped",
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    console.error(
      "FAIL  baseline is not valid JSON — regenerate it (deliberately, with a reason): node scripts/check-component-forks.mjs --write-baseline",
    );
    process.exitCode = 1;
    return;
  }
  const pinned = baseline.forks ?? {};
  const seen = new Set();

  let failures = 0;
  let newForks = 0;
  let converged = 0;

  for (const pair of pairs) {
    seen.add(pair.key);
    const consumerHash = sha256(pair.consumerText);
    const libraryHash = sha256(pair.libraryText);
    const entry = pinned[pair.key];

    if (!entry) {
      if (consumerHash === libraryHash) {
        console.log(`ok    ${pair.key}: identical to the library (mirror, not a fork)`);
      } else {
        newForks += 1;
        console.log(
          `warn  ${pair.key}: NEW fork (not in baseline) — diff ~${diffLineCount(pair.consumerText, pair.libraryText)} line(s); record it with --write-baseline`,
        );
      }
      continue;
    }

    if (consumerHash === entry.hash) {
      if (libraryHash !== entry.libHash)
        console.log(
          `note  ${pair.key}: fork unchanged but the LIBRARY file moved on — fork diff widened; consider migrating onto the library`,
        );
      else if (consumerHash === libraryHash)
        console.log(`note  ${pair.key}: 已收敛（与库一致），从基线移除`);
      continue;
    }

    if (consumerHash === libraryHash) {
      converged += 1;
      console.log(`note  ${pair.key}: 已收敛（与库一致），从基线移除`);
      continue;
    }

    // The consumer copy changed since it was pinned: silent drift unless the
    // change is an explicit baseline refresh with a recorded reason.
    failures += 1;
    console.error(
      `FAIL  ${pair.key}: fork 又漂了：要么回流库要么更新基线并附理由（baseline ${entry.hash.slice(0, 12)}… → now ${consumerHash.slice(0, 12)}…, diff vs library ~${diffLineCount(pair.consumerText, pair.libraryText)} line(s)）`,
    );
  }

  for (const key of Object.keys(pinned))
    if (!seen.has(key)) {
      converged += 1;
      console.log(`note  ${key}: consumer file gone — 已收敛/已移除，从基线移除`);
    }

  console.log(
    `\nfork guard: ${pairs.length} pair(s) — ${failures} drift failure(s), ${newForks} unpinned new fork(s), ${converged} converged entrie(s) awaiting baseline cleanup`,
  );
  if (failures > 0) process.exitCode = 1;
}

main();
