import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const openServers = new Set<ReturnType<typeof createServer>>();
const temporaryDirectories = new Set<string>();
type EnvironmentOverrides = Record<string, string | undefined>;

async function fakeNodeBin(version: string) {
  const directory = await mkdtemp(join(tmpdir(), "green-native-node-"));
  temporaryDirectories.add(directory);
  const executable = join(directory, "node");
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      'if [ "$1" = "-p" ] && [ "$2" = "process.versions.node" ]; then',
      `  printf "${version}\\n"`,
      "  exit 0",
      "fi",
      'exec "$REAL_NODE_PATH" "$@"',
      "",
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  return directory;
}

function runNativeStarter(environment: EnvironmentOverrides) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      execFile(
        join(process.cwd(), "scripts", "dev-native"),
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, ...environment },
          timeout: 5_000,
        },
        (error, stdout, stderr) => {
          const exitCode = (error as { code?: string | number } | null)?.code;
          resolve({
            code: typeof exitCode === "number" ? exitCode : error ? 1 : 0,
            stdout,
            stderr,
          });
        },
      );
    },
  );
}

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  openServers.clear();
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
});

async function runDoctorAgainst(
  data: Record<string, unknown>,
  environment: EnvironmentOverrides = {},
) {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data, error: null }));
  });
  openServers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The native doctor test server did not expose a TCP port.");
  }

  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      execFile(
        join(process.cwd(), "scripts", "doctor-native"),
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            ...environment,
            PORT: String(address.port),
          },
          timeout: 15_000,
        },
        (error, stdout, stderr) => {
          const exitCode = (error as { code?: string | number } | null)?.code;
          resolve({
            code: typeof exitCode === "number" ? exitCode : error ? 1 : 0,
            stdout,
            stderr,
          });
        },
      );
    },
  );
}

describe("native-host doctor isolation", () => {
  it("accepts the exact credential-free demo health contract", async () => {
    const result = await runDoctorAgainst({
      readiness: "ready",
      database: "not_configured",
      aiProvider: "mock",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PASS  The isolated native demo is ready");
    expect(result.stderr).toBe("");
  });

  it("rejects a stale full-stack or real-provider process", async () => {
    const result = await runDoctorAgainst({
      readiness: "ready",
      database: "reachable",
      aiProvider: "openai",
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("is not the isolated native demo");
  });

  it("rejects a nearby Node patch instead of silently weakening the pin", async () => {
    const fakeBin = await fakeNodeBin("22.23.0");

    const result = await runDoctorAgainst(
      {
        readiness: "ready",
        database: "not_configured",
        aiProvider: "mock",
      },
      {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        REAL_NODE_PATH: process.execPath,
      },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "Node.js 22.23.1 is required; found 22.23.0",
    );
  });

  it("stops the native starter before install or launch on a Node pin mismatch", async () => {
    const fakeBin = await fakeNodeBin("22.23.0");

    const result = await runNativeStarter({
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      REAL_NODE_PATH: process.execPath,
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Node.js 22.23.1 is required; found 22.23.0",
    );
    expect(result.stderr).not.toContain("Installing exact project dependencies");
  });
});
