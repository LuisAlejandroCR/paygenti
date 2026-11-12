// web/src/landing.ts: behavior of the landing page (web/landing.html) — no framework.
// Swaps the hero to the real charge-screen recording while Rosa's video is missing, lazy-loads the
// product videos when they scroll into view, honors prefers-reduced-motion and shows the poster
// with a text note when a video cannot play.
import "./styles.css";
import "./landing.css";

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
  note.textContent = "El video no se pudo cargar.";
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
    video.querySelector("track")?.remove();
    video.poster = `/media/${fallback}.jpg`;
    // A fresh <source>, so a late error from Rosa's request cannot hit the fallback.
    const next = document.createElement("source");
    next.src = `/media/${fallback}.mp4`;
    next.type = "video/mp4";
    next.addEventListener("error", () => showPoster(video));
    source.replaceWith(next);
    const caption = document.querySelector("[data-caption]");
    if (caption)
      caption.textContent =
        "Grabación real de la pantalla de cobro: desbloquear, cobrar $95, esperar y PAGADO.";
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

setupVideos();
