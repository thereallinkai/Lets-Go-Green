import { createHash } from "node:crypto";
import { ExternalFoodError } from "./food-data-types";

export const EXTERNAL_FOOD_PARSER_VERSION = "food-source-normalizer-v2";

export function payloadSha256(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function fetchProviderJson(
  url: URL,
  options: {
    userAgent: string;
    timeoutMs?: number;
    fetcher?: typeof fetch;
  },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": options.userAgent,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 404) {
      throw new ExternalFoodError("not_found", "No matching product was found.");
    }
    if (response.status === 429) {
      throw new ExternalFoodError(
        "rate_limited",
        "The food source is rate-limiting requests. Wait before trying again.",
      );
    }
    if (!response.ok) {
      throw new ExternalFoodError(
        "provider_unavailable",
        "The external food source is temporarily unavailable.",
      );
    }
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ExternalFoodError(
        "invalid_response",
        "The food source returned an unsupported response.",
      );
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExternalFoodError) throw error;
    throw new ExternalFoodError(
      "provider_unavailable",
      "The external food source could not be reached.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
