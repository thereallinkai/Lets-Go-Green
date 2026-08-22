import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const openServers = new Set<ReturnType<typeof createServer>>();

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
});

async function runDoctorAgainst(data: Record<string, unknown>) {
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
          env: { ...process.env, PORT: String(address.port) },
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
});
