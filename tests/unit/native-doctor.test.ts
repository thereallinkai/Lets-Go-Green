import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const openServers = new Set<ReturnType<typeof createServer>>();
const temporaryDirectories = new Set<string>();
type EnvironmentOverrides = Record<string, string | undefined>;

async function readEventually(path: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

async function unusedLocalPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The temporary server did not expose a TCP port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function launcherSignalFixture() {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), "green-native-launcher-"),
  );
  temporaryDirectories.add(projectDirectory);
  const scriptsDirectory = join(projectDirectory, "scripts");
  const nvmDirectory = join(projectDirectory, "fake-nvm");
  const stateDirectory = join(projectDirectory, "state");
  await Promise.all([
    mkdir(join(projectDirectory, ".git")),
    mkdir(scriptsDirectory),
    mkdir(nvmDirectory),
    mkdir(stateDirectory),
  ]);

  const launcherPath = join(scriptsDirectory, "launch-native-app");
  const starterPath = join(scriptsDirectory, "dev-native");
  await copyFile(
    join(process.cwd(), "scripts", "launch-native-app"),
    launcherPath,
  );
  await Promise.all([
    writeFile(join(projectDirectory, ".nvmrc"), "22.23.1\n"),
    writeFile(
      join(projectDirectory, "package.json"),
      JSON.stringify({
        packageManager: "npm@10.9.8",
        scripts: { "dev:native": "./scripts/dev-native" },
      }),
    ),
    writeFile(
      join(nvmDirectory, "nvm.sh"),
      [
        "nvm() {",
        '  if [ "$1" = "version" ]; then',
        '    printf "v22.23.1\\n"',
        "  fi",
        "  return 0",
        "}",
        "",
      ].join("\n"),
    ),
    writeFile(
      starterPath,
      [
        "#!/bin/bash",
        "set -Eeuo pipefail",
        "stop() {",
        '  printf "%s\\n" "$$" > "$TEST_STATE_DIR/stopped.pid"',
        "  exit 0",
        "}",
        "trap stop INT TERM HUP",
        'printf "%s\\n" "$$" > "$TEST_STATE_DIR/started.pid"',
        "while true; do",
        "  sleep 0.05",
        "done",
        "",
      ].join("\n"),
    ),
  ]);
  await Promise.all([
    chmod(launcherPath, 0o755),
    chmod(starterPath, 0o755),
  ]);

  return {
    launcherPath,
    nvmDirectory,
    projectDirectory,
    stateDirectory,
  };
}

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

function runNativeLauncher(
  launcherPath: string,
  environment: EnvironmentOverrides,
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      execFile(
        launcherPath,
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, ...environment },
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

  it.runIf(process.platform === "darwin")(
    "reuses only a native server started from the same project checkout",
    async () => {
      const { launcherPath, nvmDirectory, projectDirectory } =
        await launcherSignalFixture();
      const expectedProjectId = createHash("sha256")
        .update(await realpath(projectDirectory))
        .digest("hex");
      let reportedProjectId = expectedProjectId;
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            data: {
              readiness: "ready",
              database: "not_configured",
              aiProvider: "mock",
              nativeProjectId: reportedProjectId,
            },
            error: null,
          }),
        );
      });
      openServers.add(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("The launcher test server did not expose a TCP port.");
      }
      const environment = {
        LETS_GO_GREEN_SKIP_BROWSER_OPEN: "true",
        NVM_DIR: nvmDirectory,
        PORT: String(address.port),
      };

      const matchingResult = await runNativeLauncher(
        launcherPath,
        environment,
      );
      expect(matchingResult).toEqual({
        code: 0,
        stdout: expect.stringContaining("is already ready"),
        stderr: "",
      });

      reportedProjectId = "f".repeat(64);
      const foreignResult = await runNativeLauncher(launcherPath, environment);
      expect(foreignResult.code).toBe(1);
      expect(foreignResult.stderr).toContain(
        `Port ${address.port} is being used by another process`,
      );
    },
  );

  it.runIf(process.platform === "darwin")(
    "terminates the directly tracked native server when the launcher stops",
    async () => {
      const { launcherPath, nvmDirectory, stateDirectory } =
        await launcherSignalFixture();
      const port = await unusedLocalPort();
      const startedPath = join(stateDirectory, "started.pid");
      const stoppedPath = join(stateDirectory, "stopped.pid");
      const launcher = spawn(launcherPath, ["--with-launch-lock"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LETS_GO_GREEN_SKIP_BROWSER_OPEN: "true",
          NVM_DIR: nvmDirectory,
          PORT: String(port),
          TEST_STATE_DIR: stateDirectory,
        },
        stdio: "ignore",
      });
      const completion = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        launcher.once("error", reject);
        launcher.once("exit", (code, signal) => resolve({ code, signal }));
      });

      let serverPid: number | null = null;
      try {
        serverPid = Number((await readEventually(startedPath)).trim());
        expect(Number.isInteger(serverPid)).toBe(true);
        expect(launcher.kill("SIGTERM")).toBe(true);

        const result = await completion;
        expect(result).toEqual({ code: 130, signal: null });
        expect((await readEventually(stoppedPath)).trim()).toBe(
          String(serverPid),
        );
        expect(() => process.kill(serverPid!, 0)).toThrow();
      } finally {
        if (launcher.exitCode === null && launcher.signalCode === null) {
          launcher.kill("SIGTERM");
        }
        if (serverPid !== null) {
          try {
            process.kill(serverPid, "SIGTERM");
          } catch {
            // The launcher normally reaps the stub before test cleanup runs.
          }
        }
      }
    },
  );
});
