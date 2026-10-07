// test/agent-toolkit.test.ts: PayPal Agent Toolkit wiring for the back-office agent — allowlist
// (no money-out tool ever reaches the model), mock mode without keys, and an insights question
// routed to paypal_get_merchant_insights by a fake model. No network: the toolkit is stubbed.
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import type {
  AgentReply,
  ContentBlock,
  ModelClient,
  ModelRequest,
} from "../server/backoffice/agent";
import {
  ALLOWED_TOOLKIT_TOOLS,
  createPayPalTools,
  MONEY_OUT_TOOLKIT_TOOLS,
  PAYPAL_PREFIX,
  PayPalTools,
} from "../server/backoffice/paypal-tools";
import { MockPayPal } from "../server/paypal/mock";
import { stubToolkit } from "./support/toolkit-stub";

const moneyOut = (name: string) =>
  (MONEY_OUT_TOOLKIT_TOOLS as readonly string[]).some((m) => name.endsWith(m)) ||
  /refund|payout|pay_order|capture|accept_dispute/.test(name.replace(/^refund$/, ""));

describe("PayPal toolkit allowlist", () => {
  it("exposes exactly the allowlist, prefixed, without $schema", () => {
    const tools = new PayPalTools(stubToolkit()).tools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ALLOWED_TOOLKIT_TOOLS.map((n) => PAYPAL_PREFIX + n).sort(),
    );
    for (const t of tools) expect(t.input_schema).not.toHaveProperty("$schema");
  });

  it("never exposes a money-out toolkit tool", () => {
    const names = new PayPalTools(stubToolkit()).tools().map((t) => t.name);
    for (const bad of MONEY_OUT_TOOLKIT_TOOLS) {
      expect(names).not.toContain(bad);
      expect(names).not.toContain(PAYPAL_PREFIX + bad);
    }
    expect(names.filter(moneyOut)).toEqual([]);
  });

  it("the real toolkit, configured with our actions, offers only the allowlist", () => {
    const tools = createPayPalTools({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    expect(tools).toBeDefined();
    expect(
      tools
        ?.tools()
        .map((t) => t.name)
        .sort(),
    ).toEqual(ALLOWED_TOOLKIT_TOOLS.map((n) => PAYPAL_PREFIX + n).sort());
  });

  it("refuses a non-allowlisted name even if asked directly", async () => {
    const stub = stubToolkit();
    const tools = new PayPalTools(stub);
    for (const name of ["paypal_create_refund", "create_refund", "paypal_pay_order"]) {
      expect(tools.has(name)).toBe(false);
      expect((await tools.run(name, {})).result).toEqual({ code: "TOOL_NOT_ALLOWED" });
    }
    expect(stub.calls).toEqual([]);
  });

  it("is disabled without PayPal keys (mock mode)", async () => {
    expect(createPayPalTools({})).toBeUndefined();
    const model: ModelClient = {
      async create() {
        return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
      },
    };
    const app = createApp({ paypal: new MockPayPal(), agentModel: model });
    const cfg = (await (await app.request("/api/backoffice/config")).json()) as {
      agent: boolean;
      paypalTools: string[];
    };
    expect(cfg).toMatchObject({ agent: true, paypalTools: [] });
  });
});

describe("insights question", () => {
  it("routes 'How am I doing this month?' to paypal_get_merchant_insights", async () => {
    const stub = stubToolkit();
    const requests: ModelRequest[] = [];
    const call: ContentBlock = {
      type: "tool_use",
      id: "t1",
      name: "paypal_get_merchant_insights",
      input: {
        start_date: "2026-10-01T00:00:00Z",
        end_date: "2026-10-06T00:00:00Z",
        insight_type: "SALES",
        time_interval: "MONTHLY",
      },
    };
    const model: ModelClient = {
      async create(req) {
        requests.push(structuredClone(req));
        return requests.length === 1
          ? { content: [call], stop_reason: "tool_use" }
          : { content: [{ type: "text", text: "You sold 12,345 MXN." }], stop_reason: "end_turn" };
      },
    };
    const app = createApp({
      paypal: new MockPayPal(),
      agentModel: model,
      paypalTools: new PayPalTools(stub),
    });
    const res = await app.request("/api/backoffice/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "How am I doing this month?", locale: "en" }),
    });
    const reply = (await res.json()) as AgentReply;
    expect(requests[0]?.tools.map((t) => t.name)).toContain("paypal_get_merchant_insights");
    expect(requests[0]?.tools.map((t) => t.name)).toContain("sales_today");
    expect(stub.calls).toEqual([{ name: "get_merchant_insights", input: call.input }]);
    expect(reply.actions[0]).toMatchObject({ tool: "paypal_get_merchant_insights", ok: true });
    expect(reply.actions[0]?.summary).toBe("ok");
    expect(reply.text).toBe("You sold 12,345 MXN.");
  });
});
