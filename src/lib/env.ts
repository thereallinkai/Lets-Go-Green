import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

const serverEnvSchema = publicEnvSchema.extend({
  AI_PROVIDER: z.enum(["mock", "openai", "unavailable"]).default("mock"),
  ENABLE_REAL_AI: z.enum(["true", "false"]).default("false"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(30_000),
  USDA_FDC_API_KEY: z.string().trim().min(1).optional(),
  FOOD_LOOKUP_USER_AGENT: z
    .string()
    .trim()
    .min(8)
    .max(300)
    .default(
      "LetsGoGreen/1.0.0-beta.3 (https://github.com/thereallinkai/Lets-Go-Green)",
    ),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function getServerEnv() {
  return serverEnvSchema.parse({
    ...getPublicEnv(),
    AI_PROVIDER: process.env.AI_PROVIDER,
    ENABLE_REAL_AI: process.env.ENABLE_REAL_AI,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_REQUEST_TIMEOUT_MS: process.env.OPENAI_REQUEST_TIMEOUT_MS,
    USDA_FDC_API_KEY: process.env.USDA_FDC_API_KEY,
    FOOD_LOOKUP_USER_AGENT: process.env.FOOD_LOOKUP_USER_AGENT,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
  });
}

export function isSupabaseConfigured() {
  const env = getPublicEnv();
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function isDevelopmentDemo() {
  return process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
}

export function getAIProviderMode(): "mock" | "openai" | "unavailable" {
  const env = getServerEnv();
  if (env.AI_PROVIDER === "unavailable") return "unavailable";
  if (
    env.AI_PROVIDER === "openai" &&
    env.ENABLE_REAL_AI === "true" &&
    env.OPENAI_API_KEY &&
    env.OPENAI_MODEL
  ) {
    return "openai";
  }
  return "mock";
}
