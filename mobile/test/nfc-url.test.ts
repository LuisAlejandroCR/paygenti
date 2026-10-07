// test/nfc-url.test.ts: the sticker/HCE URL is PUBLIC_URL/t/:terminal, base URLs are normalised,
// bad input is refused and the NDEF size check matches the NTAG213 limit of 144 bytes.
import {
  fitsNtag213,
  ndefTagBytes,
  normalizeBaseUrl,
  terminalPayUrl,
  uriPayload,
} from "@/lib/nfc-url";

describe("terminalPayUrl", () => {
  it("joins the public URL and terminal", () => {
    expect(terminalPayUrl("https://paygent-rirl.onrender.com/", "rosa-01")).toBe(
      "https://paygent-rirl.onrender.com/t/rosa-01",
    );
    expect(terminalPayUrl("http://192.168.1.20:8787", "rosa-01")).toBe(
      "http://192.168.1.20:8787/t/rosa-01",
    );
  });

  it("rejects bad bases and terminal ids", () => {
    expect(() => terminalPayUrl("ftp://x", "rosa-01")).toThrow();
    expect(() => terminalPayUrl("https://x.com", "Rosa 01")).toThrow();
    expect(() => terminalPayUrl("https://x.com", "../admin")).toThrow();
    expect(normalizeBaseUrl("  https://x.com//  ")).toBe("https://x.com");
    expect(normalizeBaseUrl("x.com")).toBeUndefined();
  });
});

describe("NDEF sizing", () => {
  it("compresses the https:// prefix into one byte", () => {
    const p = uriPayload("https://a.co/t/x");
    expect(p[0]).toBe(0x04);
    expect(p.length).toBe(1 + "a.co/t/x".length);
    expect(uriPayload("http://www.a.co")[0]).toBe(0x01);
  });

  it("fits the production link on an NTAG213 and refuses a huge one", () => {
    const url = "https://paygent-rirl.onrender.com/t/rosa-01";
    // TLV tag+len (2) + record header/typeLen/payloadLen/type (4) + payload + terminator (1)
    expect(ndefTagBytes(url)).toBe(2 + 4 + (1 + url.length - "https://".length) + 1);
    expect(fitsNtag213(url)).toBe(true);
    expect(fitsNtag213(`https://${"a".repeat(200)}.com/t/x`)).toBe(false);
  });
});
