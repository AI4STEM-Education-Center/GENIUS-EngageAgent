import type { SlideDraft } from "./model";

export function slideVideo(value: unknown): { url: string; embed: string; kind: "iframe" | "video" } | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const host = url.hostname.toLowerCase();
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"].includes(host)) {
      const id = host === "youtu.be" ? url.pathname.slice(1) : url.pathname.startsWith("/embed/") ? url.pathname.slice(7) : url.pathname.startsWith("/shorts/") ? url.pathname.slice(8) : url.searchParams.get("v");
      if (!id || !/^[a-zA-Z0-9_-]{11}$/u.test(id)) return null;
      return { url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}`, kind: "iframe" };
    }
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
      const id = /^\/(?:video\/)?([0-9]{1,15})\/?$/u.exec(url.pathname)?.[1];
      return id ? { url: `https://vimeo.com/${id}`, embed: `https://player.vimeo.com/video/${id}`, kind: "iframe" } : null;
    }
    // Direct media is played by the browser, never fetched by our server.
    // Do not turn a shared slide into a request to local network services.
    if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") || host.startsWith("[") || /^\d+(?:\.\d+){3}$/u.test(host)) return null;
    if (!/\.(mp4|webm|ogg)$/iu.test(url.pathname)) return null;
    return { url: url.href, embed: url.href, kind: "video" };
  } catch { return null; }
}

/** AI text revisions do not silently remove teacher-selected media. */
export function preserveSlideVideos(original: SlideDraft | undefined, revised: SlideDraft): SlideDraft {
  if (!original?.slides.some(slide => slide.videoUrl)) return revised;
  return { ...revised, slides: revised.slides.map(slide => {
    const videoUrl = original.slides.find(previous => previous.stage === slide.stage)?.videoUrl;
    return videoUrl ? { ...slide, videoUrl } : slide;
  }) };
}
