// test/support/toolkit-stub.ts: a no-network stand-in for PayPal's Agent Toolkit (Bedrock adapter).
// Advertises every toolkit tool, money-out ones included, and records each call it receives.
import type { ToolkitLike } from "../../server/backoffice/paypal-tools";

export const ALL_TOOLKIT_NAMES = [
  "create_invoice",
  "list_invoices",
  "get_invoice",
  "send_invoice",
  "send_invoice_reminder",
  "cancel_sent_invoice",
  "generate_invoice_qr_code",
  "record_refund_for_invoice",
  "create_order",
  "get_order",
  "pay_order",
  "create_refund",
  "get_refund",
  "list_disputes",
  "get_dispute",
  "accept_dispute_claim",
  "list_transactions",
  "get_merchant_insights",
  "create_subscription",
  "cancel_subscription",
];

export function stubToolkit(): ToolkitLike & { calls: Array<{ name: string; input: unknown }> } {
  const calls: Array<{ name: string; input: unknown }> = [];
  return {
    calls,
    getTools: () =>
      ALL_TOOLKIT_NAMES.map((name) => ({
        toolSpec: {
          name,
          description: `stub ${name}`,
          inputSchema: {
            json: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: {},
            },
          },
        },
      })),
    async handleToolCall(call) {
      calls.push({ name: call.name, input: call.input });
      const body =
        call.name === "get_merchant_insights"
          ? { insight_type: "SALES", total: { value: "12345.00", currency_code: "MXN" } }
          : call.name === "list_transactions"
            ? { transaction_details: [{ id: "T1" }, { id: "T2" }] }
            : { id: "X1", status: "OK" };
      return { content: [{ text: JSON.stringify(body) }] };
    },
  };
}
