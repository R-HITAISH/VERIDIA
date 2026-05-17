import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-20250514"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  OPENAI_MODEL_FAST: z.string().default("gpt-4o-mini"),

  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  SEC_EDGAR_USER_AGENT: z
    .string()
    .default("Veridia Diligence Engine contact@example.com"),

  SLACK_WEBHOOK_URL: z.string().optional(),

  WEBHOOK_SHARED_SECRET: z.string().default("change-me"),

  OMIUM_API_KEY: z.string().optional(),
  OMIUM_PROJECT_ID: z.string().optional(),
  OMIUM_ENDPOINT: z.string().default("https://api.omium.ai"),
});

export const config = Env.parse(process.env);
export type Config = z.infer<typeof Env>;
