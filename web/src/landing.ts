// web/src/landing.ts: behavior of the landing page (web/landing.html) — no framework.
// Swaps the hero to the real charge-screen recording while Rosa's video is missing, lazy-loads the
// product videos when they scroll into view, honors prefers-reduced-motion and shows the poster
// with a text note when a video cannot play. Steps the sale simulator, reveals the story chapters as
// they scroll in and marks the current one in the chapter rail; runs the hero's box-state loop and
// counts the problem stats up once. Also runs the ES/EN toggle: strings live in
// landing-strings.ts, keyed by the data-i18n* attributes in landing.html; the locale (detection,
// storage, <html lang>) is shared with the apps through i18n.ts.
import "./styles.css";
import "./landing.css";
import { getLocale, type Locale, setLocale } from "./i18n";
import { LANDING, type LandingKey } from "./landing-strings";

let locale: Locale = getLocale();
const tr = (key: LandingKey) => LANDING[locale][key];

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** Starts a muted video unless the visitor asked for reduced motion; autoplay may still be refused. */
function play(video: HTMLVideoElement) {
  if (reduceMotion.matches) return;
  void video.play().catch(() => {});
}

/** Replaces a video that cannot play with its poster image and a short note. */
function showPoster(video: HTMLVideoElement) {
  const frame = video.parentElement;
  if (!frame || frame.querySelector(".lp-poster")) return;
  const img = document.createElement("img");
  img.className = "lp-poster";
  img.src = video.poster;
  img.alt = "";
  const note = document.createElement("p");
  note.className = "lp-video-note";
  note.dataset.i18n = "video.failed";
  note.textContent = tr("video.failed");
  video.replaceWith(img);
  frame.append(note);
}

/** Hero: Rosa's video if it exists, else the real charge recording (and its caption). */
function setupHero(video: HTMLVideoElement) {
  const fallback = video.dataset.fallback;
  const source = video.querySelector("source");
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    if (!fallback || !source) return showPoster(video);
    for (const track of video.querySelectorAll("track")) track.remove();
    video.poster = `/media/${fallback}.jpg`;
    // A fresh <source>, so a late error from Rosa's request cannot hit the fallback.
    const next = document.createElement("source");
    next.src = `/media/${fallback}.mp4`;
    next.type = "video/mp4";
    next.addEventListener("error", () => showPoster(video));
    source.replaceWith(next);
    const caption = document.querySelector("[data-caption]");
    if (caption) {
      caption.setAttribute("data-i18n", "hero.captionFallback");
      caption.textContent = tr("hero.captionFallback");
    }
    video.load();
    play(video);
  };
  // A missing file fails on the <source>.
  source?.addEventListener("error", swap);
  // Rosa's file is only used if it really is a playable video (an SPA fallback page is not).
  fetch("/media/hero-person.mp4", { method: "HEAD" })
    .then((r) => {
      if (!r.ok || !r.headers.get("content-type")?.startsWith("video/")) swap();
    })
    .catch(swap);
}

function setupVideos() {
  const videos = [...document.querySelectorAll<HTMLVideoElement>("video[data-autoplay]")];
  const hero = document.querySelector<HTMLVideoElement>("[data-hero] video");
  if (hero) setupHero(hero);

  for (const v of videos) {
    if (v !== hero) {
      v.querySelector("source")?.addEventListener("error", () => showPoster(v));
      v.addEventListener("error", () => showPoster(v));
    }
    // With reduced motion nothing moves on its own; the controls still play on request.
    if (reduceMotion.matches) {
      v.removeAttribute("autoplay");
      v.pause();
    }
  }

  const lazy = videos.filter((v) => v.dataset.lazy !== undefined);
  if (!("IntersectionObserver" in window)) {
    for (const v of lazy) play(v);
    return;
  }
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) {
          if (v.preload === "none") v.preload = "metadata";
          play(v);
        } else if (!v.paused) v.pause();
      }
    },
    { rootMargin: "120px 0px", threshold: 0.25 },
  );
  for (const v of lazy) seen.observe(v);
}

/** Full-demo slot: reveal the section only once /media/demo.mp4 is a real video file. */
function setupDemo() {
  const section = document.querySelector<HTMLElement>("[data-demo]");
  if (!section) return;
  fetch("/media/demo.mp4", { method: "HEAD" })
    .then((r) => {
      if (r.ok && r.headers.get("content-type")?.startsWith("video/")) section.hidden = false;
    })
    .catch(() => {});
}

/** Captions follow the language: if they are on, the track in the new language takes over. */
function syncTracks() {
  for (const video of document.querySelectorAll("video")) {
    const tracks = [...video.textTracks];
    if (!tracks.some((t) => t.mode === "showing")) continue;
    for (const t of tracks) t.mode = t.language === locale ? "showing" : "disabled";
  }
}

/** Paints every data-i18n* element, the title, the meta tags and the toggle in `next`. */
function applyLocale(next: Locale) {
  locale = next;
  // Strings are constants from landing-strings.ts (some carry <strong>), never user input.
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]"))
    el.innerHTML = tr(el.dataset.i18n as LandingKey);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-label]"))
    el.setAttribute("aria-label", tr(el.dataset.i18nLabel as LandingKey));
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-content]"))
    el.setAttribute("content", tr(el.dataset.i18nContent as LandingKey));
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-alt]"))
    el.setAttribute("alt", tr(el.dataset.i18nAlt as LandingKey));
  document.title = tr("meta.title");
  document
    .querySelector('meta[property="og:locale"]')
    ?.setAttribute("content", next === "es" ? "es_MX" : "en_US");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-lang]"))
    b.setAttribute("aria-pressed", String(b.dataset.lang === next));
  syncTracks();
}

function setupLang() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-lang]")) {
    b.addEventListener("click", () => {
      const next = b.dataset.lang === "en" ? "en" : "es";
      if (next === locale) return;
      setLocale(next); // persists the choice (try/catch inside) and sets <html lang>
      applyLocale(next);
    });
  }
  applyLocale(locale);
}

/**
 * Hero sale simulator: four static screens (landing.html) shown one at a time. "Next step" moves
 * by hand; "Play it for me" walks through on a timer and is hidden under reduced motion. It only
 * toggles `hidden`; nothing here talks to the server or PayPal.
 */
function setupSim() {
  const root = document.querySelector<HTMLElement>("[data-sim]");
  if (!root) return;
  const screens = [...root.querySelectorAll<HTMLElement>("[data-sim-screen]")];
  const dots = [...root.querySelectorAll<HTMLElement>("[data-sim-dot]")];
  const next = root.querySelector<HTMLButtonElement>("[data-sim-next]");
  const playBtn = root.querySelector<HTMLButtonElement>("[data-sim-play]");
  const last = screens.length;
  let step = 1;
  let timer: number | undefined;

  const show = (n: number) => {
    step = n;
    root.dataset.step = String(n);
    for (const s of screens) s.hidden = s.dataset.simScreen !== String(n);
    for (const d of dots) {
      if (d.dataset.simDot === String(n)) d.setAttribute("aria-current", "step");
      else d.removeAttribute("aria-current");
    }
    if (next) {
      next.dataset.i18n = n === last ? "sim.again" : "sim.next";
      next.textContent = tr(next.dataset.i18n as LandingKey);
    }
  };
  const stop = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };

  next?.addEventListener("click", () => {
    stop();
    show(step >= last ? 1 : step + 1);
  });
  if (playBtn) {
    if (reduceMotion.matches) playBtn.hidden = true;
    playBtn.addEventListener("click", () => {
      stop();
      show(1);
      timer = window.setInterval(() => {
        if (step >= last) return stop();
        show(step + 1);
      }, 1800);
    });
  }
  show(1);
}

/** Story: each chapter slides in once when it enters, and the rail marks the chapter in view. */
function setupStory() {
  const chapters = [...document.querySelectorAll<HTMLElement>("[data-chapter]")];
  const rail = [...document.querySelectorAll<HTMLAnchorElement>("[data-rail]")];
  if (!chapters.length || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("lp-js");
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        reveal.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
  );
  const current = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of rail) {
          if (a.hash === `#${e.target.id}`) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        }
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  for (const c of chapters) {
    reveal.observe(c);
    current.observe(c);
  }
}

/** Hero: the small box screen walks listen → QR → paid, like the real box; still under reduced motion. */
function setupLive() {
  const live = document.querySelector<HTMLElement>("[data-live]");
  if (!live) return;
  const states = [...live.querySelectorAll<HTMLElement>("[data-live-state]")];
  const show = (name: string) => {
    live.dataset.state = name;
    for (const s of states) s.hidden = s.dataset.liveState !== name;
  };
  if (reduceMotion.matches) return show("paid");
  const order = ["listen", "qr", "paid"];
  const hold = [1800, 1800, 2600];
  let i = 0;
  const step = () => {
    show(order[i] as string);
    window.setTimeout(step, hold[i]);
    i = (i + 1) % order.length;
  };
  step();
}

/** Problem stats count up from zero once their chapter is in view. */
function setupCounts() {
  if (reduceMotion.matches || !("IntersectionObserver" in window)) return;
  const nums = [...document.querySelectorAll<HTMLElement>("[data-count]")];
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        const el = e.target as HTMLElement;
        const out = el.querySelector<HTMLElement>(".lp-count");
        const end = Number(el.dataset.count);
        const suffix = (el.dataset.suffix ?? "").replace(/&nbsp;/g, " ");
        if (!out || !Number.isFinite(end)) continue;
        const t0 = performance.now();
        const tick = (now: number) => {
          const k = Math.min(1, (now - t0) / 900);
          out.textContent = `${Math.round(end * (1 - (1 - k) ** 3))}${suffix}`;
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.6 },
  );
  for (const n of nums) seen.observe(n);
}

setupLang();
setupLive();
setupCounts();
setupStory();
setupSim();
setupVideos();
setupDemo();
