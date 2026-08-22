#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinationRoot = path.join(root, "public", "ocr-runtime");
const checkOnly = process.argv.includes("--check");

const packages = [
  ["tesseract.js", "7.0.0"],
  ["tesseract.js-core", "7.0.0"],
  ["@tesseract.js-data/eng", "1.0.0"],
];

function packageRoot(name) {
  return path.dirname(require.resolve(`${name}/package.json`));
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function relativeFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await relativeFiles(path.join(directory, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

for (const [name, expectedVersion] of packages) {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot(name), "package.json"), "utf8"),
  );
  if (packageJson.version !== expectedVersion) {
    throw new Error(
      `${name} ${expectedVersion} is required for the local OCR runtime; found ${packageJson.version ?? "an unreadable version"}.`,
    );
  }
}

const tesseractRoot = packageRoot("tesseract.js");
const coreRoot = packageRoot("tesseract.js-core");
const englishRoot = packageRoot("@tesseract.js-data/eng");
const assets = [
  [path.join(tesseractRoot, "dist", "worker.min.js"), "worker.min.js"],
  [
    path.join(coreRoot, "tesseract-core-lstm.wasm.js"),
    "core/tesseract-core-lstm.wasm.js",
  ],
  [
    path.join(coreRoot, "tesseract-core-simd-lstm.wasm.js"),
    "core/tesseract-core-simd-lstm.wasm.js",
  ],
  [
    path.join(coreRoot, "tesseract-core-relaxedsimd-lstm.wasm.js"),
    "core/tesseract-core-relaxedsimd-lstm.wasm.js",
  ],
  [
    path.join(englishRoot, "4.0.0_best_int", "eng.traineddata.gz"),
    "lang/eng.traineddata.gz",
  ],
  [path.join(root, "THIRD_PARTY_NOTICES.md"), "THIRD_PARTY_NOTICES.md"],
  [path.join(root, "licenses", "APACHE-2.0.txt"), "licenses/APACHE-2.0.txt"],
  [path.join(root, "licenses", "MIT.txt"), "licenses/MIT.txt"],
  [
    path.join(root, "licenses", "BSD-3-Clause.txt"),
    "licenses/BSD-3-Clause.txt",
  ],
  [
    path.join(root, "licenses", "tesseract-worker-bundled-notices.txt"),
    "worker.min.js.LICENSE.txt",
  ],
];

if (
  (await sha256(path.join(root, "licenses", "APACHE-2.0.txt"))) !==
  (await sha256(path.join(tesseractRoot, "LICENSE.md")))
) {
  throw new Error(
    "The committed Apache-2.0 text must stay byte-identical to the pinned Tesseract.js license.",
  );
}

if (
  (await sha256(path.join(root, "licenses", "tesseract-worker-bundled-notices.txt"))) !==
  (await sha256(path.join(tesseractRoot, "dist", "worker.min.js.LICENSE.txt")))
) {
  throw new Error(
    "The committed Tesseract worker notice must stay byte-identical to the pinned package sidecar.",
  );
}

if (!checkOnly) {
  await rm(destinationRoot, { recursive: true, force: true });
}

const manifest = {
  packages: Object.fromEntries(packages),
  assets: {},
};

for (const [source, relativeDestination] of assets) {
  const destination = path.join(destinationRoot, relativeDestination);
  const sourceHash = await sha256(source);
  manifest.assets[relativeDestination] = sourceHash;

  if (!checkOnly) {
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}`;
    await copyFile(source, temporary);
    await rename(temporary, destination);
  }

  try {
    const destinationStat = await stat(destination);
    if (!destinationStat.isFile() || (await sha256(destination)) !== sourceHash) {
      throw new Error("checksum mismatch");
    }
  } catch {
    throw new Error(
      `Local OCR asset ${relativeDestination} is missing or does not match its pinned package. Run npm run ocr:assets.`,
    );
  }
}

const manifestPath = path.join(destinationRoot, "manifest.json");
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
if (!checkOnly) {
  await writeFile(manifestPath, manifestText, "utf8");
}
if ((await readFile(manifestPath, "utf8").catch(() => "")) !== manifestText) {
  throw new Error(
    "The local OCR asset manifest is missing or stale. Run npm run ocr:assets.",
  );
}

const expectedFiles = new Set([
  ...assets.map(([, relativeDestination]) => relativeDestination),
  "manifest.json",
]);
const unexpectedFiles = (await relativeFiles(destinationRoot)).filter(
  (relativePath) => !expectedFiles.has(relativePath),
);
if (unexpectedFiles.length) {
  throw new Error(
    `Local OCR runtime contains unexpected files: ${unexpectedFiles.join(", ")}. Run npm run ocr:assets.`,
  );
}

process.stdout.write(
  checkOnly
    ? "Local OCR assets match the pinned packages.\n"
    : "Prepared same-origin OCR assets from pinned packages.\n",
);
