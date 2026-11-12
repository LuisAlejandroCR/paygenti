// scripts/record-landing.ts: records the real web app at phone size for the landing page
// (npm run landing:record) — starts the mock server, unlocks the vendor screen with the demo PIN,
// charges 95, pays from the customer checkout and saves both phone recordings as mp4 + poster
// in web/public/media/. Nothing is staged: it is the same app and mock gateway the e2e suite uses.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 8793;
const BASE = `http://localhost:${PORT}`;
const MEDIA = resolve(ROOT, "web/public/media");
const RAW = resolve(ROOT, "landing-raw");
const SIZE = { width: 390, height: 844 };

let server: ChildProcess | undefined;
function stopServer() {
  if (!server || server.exitCode !== null || server.pid === undefined) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
  server = undefined;
}
process.on("exit", stopServer);

async function startServer() {
  if (process.env.REC_SKIP_BUILD !== "1") {
    const b = spawnSync("npm", ["run", "build"], { cwd: ROOT, shell: true, stdio: "inherit" });
    if (b.status !== 0) throw new Error("npm run build failed");
  }
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      PUBLIC_URL: "",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_WEBHOOK_ID: "",
      ANTHROPIC_API_KEY: "",
      VENDOR_PIN: "",
      DATABASE_URL: "",
    },
    stdio: "ignore",
  });
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (
      await fetch(`${BASE}/api/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not become healthy");
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

async function phone(browser: Awaited<ReturnType<typeof chromium.launch>>, dir: string) {
  return browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-MX",
    colorScheme: "light",
    recordVideo: { dir, size: SIZE },
  });
}

/** Closes the context and moves its single recording to `name`.webm in RAW. */
async function finish(ctx: BrowserContext, dir: string, name: string) {
  await ctx.close();
  const [file] = readdirSync(dir).filter((f) => f.endsWith(".webm"));
  if (!file) throw new Error(`no recording in ${dir}`);
  renameSync(join(dir, file), join(RAW, `${name}.webm`));
}

/** webm → H.264 mp4 (faststart, no audio) and a poster jpg taken at `posterAt` seconds. */
function encode(name: string, posterAt: number) {
  const src = join(RAW, `${name}.webm`);
  const mp4 = join(MEDIA, `${name}.mp4`);
  const run = (args: string[]) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  };
  run([
    ...["-i", src, "-an", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "26"],
    ...["-preset", "slow", "-movflags", "+faststart", mp4],
  ]);
  run([
    "-ss",
    String(posterAt),
    "-i",
    mp4,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    join(MEDIA, `${name}.jpg`),
  ]);
}

async function main() {
  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });
  mkdirSync(MEDIA, { recursive: true });
  await startServer();
  const browser = await chromium.launch();

  const vDir = join(RAW, "vendor");
  const cDir = join(RAW, "customer");
  const vendorCtx = await phone(browser, vDir);
  const vendor = await vendorCtx.newPage();
  await vendor.goto(`${BASE}/?terminal=rosa-01`);
  await pause(vendor, 1200);
  // Unlock once with the demo PIN, as the vendor's phone does the first time.
  const pin = vendor.locator("form.unlock input").first();
  await pin.click();
  await pin.pressSequentially("1234", { delay: 180 });
  await vendor.locator("form.unlock button[type=submit]").click();
  await vendor.locator(".entry").waitFor();
  await pause(vendor, 900);
  for (const d of "95") {
    await vendor.getByRole("button", { name: d, exact: true }).click();
    await pause(vendor, 350);
  }
  await pause(vendor, 600);
  await vendor.locator(".entry button.primary").click();
  await vendor.locator(".waiting").waitFor();
  await pause(vendor, 2500);

  // The customer opens the sale from the sticker link and pays on the mock gateway.
  const customerCtx = await phone(browser, cDir);
  const customer = await customerCtx.newPage();
  await customer.goto(`${BASE}/t/rosa-01`);
  const pay = customer.getByRole("button", { name: "Pagar (simulado)" });
  await pay.waitFor();
  await pause(customer, 2000);
  await pay.click();
  await customer.getByText("¡Pago recibido! Gracias.").waitFor();
  await pause(customer, 2500);

  await vendor.getByText("PAGADO", { exact: true }).waitFor();
  await pause(vendor, 3500);

  await finish(customerCtx, cDir, "app-checkout");
  await finish(vendorCtx, vDir, "app-charge");
  await browser.close();
  stopServer();

  encode("app-charge", 6);
  encode("app-checkout", 1.5);
  rmSync(RAW, { recursive: true, force: true });
  console.log(`saved app-charge.mp4 and app-checkout.mp4 (+ .jpg posters) in ${MEDIA}`);
}

main().catch((err) => {
  console.error(err);
  stopServer();
  process.exit(1);
});
