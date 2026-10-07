// server/backoffice/paypal-tools.ts: PayPal's official Agent Toolkit (@paypal/agent-toolkit, Bedrock
// adapter) exposed to the back-office agent through a curated allowlist of read and money-in tools.
// Money-out tools (refunds, payouts, order payment, dispute acceptance) are never enabled or exposed:
// refunds only go through BackOffice.refund -> PolicyEngine with the human's PIN.
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/bedrock";

/** Prefix that marks a tool as PayPal's in the model's tool list and in the UI. */
export const PAYPAL_PREFIX = "paypal_";

/** Toolkit tools the model may call (toolkit names, without our prefix). Read or money-in only. */
export const ALLOWED_TOOLKIT_TOOLS = [
  "list_transactions",
  "get_merchant_insights",
  "get_order",
  "list_invoices",
  "get_invoice",
  "send_invoice",
  "generate_invoice_qr_code",
  "list_disputes",
  "get_dispute",
] as const;

/** Toolkit tools that move money out or give up a claim: must never reach the model. */
export const MONEY_OUT_TOOLKIT_TOOLS = [
  "create_refund",
  "pay_order",
  "accept_dispute_claim",
  "record_refund_for_invoice",
  "cancel_sent_invoice",
  "create_order",
] as const;

/** Toolkit `configuration.actions` enabling exactly the allowlist (first fence; the filter is the second). */
export const TOOLKIT_ACTIONS = {
  transactions: { list: true },
  insights: { get: true },
  orders: { get: true },
  invoices: { list: true, get: true, send: true, generateQRC: true },
  disputes: { list: true, get: true },
};

const MAX_RESULT_CHARS = 4000;

export interface ToolkitToolSpec {
  toolSpec: { name: string; description: string; inputSchema: { json: unknown } };
}

/** The slice of the toolkit's Bedrock adapter we use; tests inject a stub. */
export interface ToolkitLike {
  getTools(): ToolkitToolSpec[];
  handleToolCall(call: {
    toolUseId: string;
    name: string;
    input: unknown;
  }): Promise<{ content: Array<{ text: string }> }>;
}

export interface AnthropicToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const allowed = new Set<string>(ALLOWED_TOOLKIT_TOOLS);

export class PayPalTools {
  private readonly specs: AnthropicToolSpec[];

  constructor(private readonly toolkit: ToolkitLike) {
    this.specs = toolkit
      .getTools()
      .filter((t) => allowed.has(t.toolSpec.name))
      .map((t) => {
        const { $schema: _drop, ...schema } = t.toolSpec.inputSchema.json as Record<
          string,
          unknown
        >;
        return {
          name: PAYPAL_PREFIX + t.toolSpec.name,
          description: `[PayPal Agent Toolkit] ${t.toolSpec.description}`.slice(0, 1024),
          input_schema: schema,
        };
      });
  }

  /** Anthropic tool definitions for the allowed toolkit tools. */
  tools(): AnthropicToolSpec[] {
    return this.specs;
  }

  has(name: string): boolean {
    return this.specs.some((s) => s.name === name);
  }

  async run(name: string, input: unknown): Promise<{ ok: boolean; result: unknown }> {
    const bare = name.startsWith(PAYPAL_PREFIX) ? name.slice(PAYPAL_PREFIX.length) : "";
    if (!this.has(name) || !allowed.has(bare))
      return { ok: false, result: { code: "TOOL_NOT_ALLOWED" } };
    const res = await this.toolkit.handleToolCall({ toolUseId: name, name: bare, input });
    const text = res.content.map((c) => c.text).join("");
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep text
    }
    const failed = typeof parsed === "string" && /^error|failed/i.test(parsed);
    const result =
      text.length > MAX_RESULT_CHARS
        ? { truncated: true, text: text.slice(0, MAX_RESULT_CHARS) }
        : parsed;
    return { ok: !failed, result };
  }
}

/** Real toolkit when PayPal keys are set; undefined in mock mode (agent keeps only our tools). */
export function createPayPalTools(
  env: Record<string, string | undefined>,
): PayPalTools | undefined {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  const live = /api-m\.paypal\.com/.test(env.PAYPAL_API_URL ?? "");
  const toolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: { actions: TOOLKIT_ACTIONS, context: { sandbox: !live } },
  });
  return new PayPalTools(toolkit as unknown as ToolkitLike);
}

/** One short line for the UI: what the tool returned, without dumping the payload. */
export function shortResult(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result.slice(0, 80);
  if (typeof result !== "object") return String(result).slice(0, 80);
  const r = result as Record<string, unknown>;
  if (typeof r.code === "string") return r.code;
  for (const key of ["transaction_details", "items", "invoices", "disputes", "sales"]) {
    const v = r[key];
    if (Array.isArray(v)) return `${v.length} ${key.replace("_details", "s")}`;
  }
  if (typeof r.status === "string") return r.status;
  if (typeof r.id === "string") return r.id;
  return "ok";
}
