// server/voice/index.ts: voice -> cart entry point. Uses Claude when ANTHROPIC_API_KEY is set and
// falls back to the deterministic rules parser on any error, timeout or empty result.
import type { CatalogItem } from "../../shared/types";
import { parseWithClaude } from "./llm";
import { type ParseResult, parseOrder } from "./rules";

export interface VoiceResult extends ParseResult {
  source: "llm" | "rules";
}

export interface VoiceEnv {
  ANTHROPIC_API_KEY?: string;
}

export interface VoiceOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function parseVoice(
  text: string,
  catalog: CatalogItem[],
  env: VoiceEnv,
  opts: VoiceOptions = {},
): Promise<VoiceResult> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    try {
      const result = await parseWithClaude(text, catalog, { apiKey, ...opts });
      if (result.lines.length > 0) return { ...result, source: "llm" };
    } catch {
      // Fall through to the rules parser.
    }
  }
  return { ...parseOrder(text, catalog), source: "rules" };
}

export { parseWithClaude } from "./llm";
export { parseOrder } from "./rules";
