// test/stt.test.ts: browser speech mode selection — native Web Speech first, MediaRecorder +
// server transcription for Firefox, and "none" (announced, never silent) when neither works.
import { describe, expect, it } from "vitest";
import { pickMode } from "../web/src/stt";

const base = { native: false, recorder: true, mic: true, server: true };

describe("pickMode", () => {
  it("prefers the native recognizer when present", () => {
    expect(pickMode({ ...base, native: true, server: false })).toBe("native");
  });
  it("records and transcribes on the server when there is no recognizer (Firefox)", () => {
    expect(pickMode(base)).toBe("record");
  });
  it("is none without recorder, mic or a server transcriber", () => {
    expect(pickMode({ ...base, recorder: false })).toBe("none");
    expect(pickMode({ ...base, mic: false })).toBe("none");
    expect(pickMode({ ...base, server: false })).toBe("none");
  });
});
