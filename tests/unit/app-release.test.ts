import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import packageManifest from "../../package.json";
import { APP_RELEASE, parseAppRelease } from "@/src/lib/app-release";

describe("application release metadata", () => {
  it("uses the package manifest as the canonical current version", () => {
    const lockfile = JSON.parse(
      readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"),
    ) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };

    expect(APP_RELEASE.version).toBe("1.0.0-beta.4");
    expect(APP_RELEASE.version).toBe(packageManifest.version);
    expect(lockfile.version).toBe(packageManifest.version);
    expect(lockfile.packages?.[""]?.version).toBe(packageManifest.version);
  });

  it("presents the current prerelease as Beta 4", () => {
    expect(APP_RELEASE).toMatchObject({
      channel: "beta",
      channelLabel: "Beta 4",
      displayLabel: "Beta 4 · v1.0.0-beta.4",
      displayVersion: "v1.0.0-beta.4",
      isPrerelease: true,
    });
  });

  it("classifies stable, release-candidate, and custom preview versions", () => {
    expect(parseAppRelease("1.0.1")).toMatchObject({
      channel: "stable",
      channelLabel: "Stable",
      isPrerelease: false,
    });
    expect(parseAppRelease("1.1.0-rc.2")).toMatchObject({
      channel: "rc",
      channelLabel: "Release candidate 2",
    });
    expect(parseAppRelease("2.0.0-canary.7")).toMatchObject({
      channel: "preview",
      channelLabel: "Preview canary.7",
    });
  });

  it("rejects versions that are not valid semantic versions", () => {
    expect(() => parseAppRelease("1.0 beta")).toThrow(
      "Invalid application version",
    );
  });
});
