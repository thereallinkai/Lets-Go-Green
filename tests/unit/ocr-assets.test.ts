import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const runtimeRoot = path.join(root, "public", "ocr-runtime");

async function sha256(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

describe("local OCR redistribution assets", () => {
  it("ships every notice and full license under a manifest checksum", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(runtimeRoot, "manifest.json"), "utf8"),
    ) as { assets: Record<string, string> };
    const required = [
      "THIRD_PARTY_NOTICES.md",
      "licenses/APACHE-2.0.txt",
      "licenses/MIT.txt",
      "licenses/BSD-3-Clause.txt",
      "worker.min.js.LICENSE.txt",
    ];

    for (const relativePath of required) {
      expect(manifest.assets[relativePath], relativePath).toMatch(/^[a-f0-9]{64}$/);
      await expect(sha256(path.join(runtimeRoot, relativePath))).resolves.toBe(
        manifest.assets[relativePath],
      );
    }

    await expect(
      readFile(path.join(runtimeRoot, "licenses", "APACHE-2.0.txt"), "utf8"),
    ).resolves.toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
    await expect(
      readFile(path.join(runtimeRoot, "licenses", "MIT.txt"), "utf8"),
    ).resolves.toContain("Permission is hereby granted, free of charge");
    await expect(
      readFile(
        path.join(runtimeRoot, "worker.min.js.LICENSE.txt"),
        "utf8",
      ),
    ).resolves.toContain("ieee754. BSD-3-Clause License");
  });

  it("keeps the committed Apache text byte-identical to the pinned upstream package", async () => {
    await expect(sha256(path.join(root, "licenses", "APACHE-2.0.txt"))).resolves.toBe(
      await sha256(path.join(root, "node_modules", "tesseract.js", "LICENSE.md")),
    );
  });

  it("keeps the committed worker sidecar byte-identical to the pinned bundle notice", async () => {
    await expect(
      sha256(path.join(root, "licenses", "tesseract-worker-bundled-notices.txt")),
    ).resolves.toBe(
      await sha256(
        path.join(
          root,
          "node_modules",
          "tesseract.js",
          "dist",
          "worker.min.js.LICENSE.txt",
        ),
      ),
    );
  });
});
