import { describe, expect, it } from "vitest";
import { sameMediaResource, stableContentMedia, stableMediaUrl } from "@/lib/stable-media-urls";

const now = Date.parse("2026-11-03T12:00:00Z");
function s3({ path = "material-gallery/source/video-one.mp4", signedAt = now, expires = 900, signature = "a", query = "", host = "materials.s3.us-east-2.amazonaws.com" } = {}) {
  const params = new URLSearchParams(query);
  params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  params.set("X-Amz-Date", new Date(signedAt).toISOString().replace(/[-:]/gu, "").replace(".000", ""));
  params.set("X-Amz-Expires", String(expires));
  params.set("X-Amz-Signature", signature.repeat(64));
  params.set("X-Amz-SignedHeaders", "host");
  params.set("X-Amz-Credential", `${signature}/date/region/s3/aws4_request`);
  params.set("X-Amz-Security-Token", `temporary-${signature}`);
  return `https://${host}/${path}?${params}`;
}
function ticket(resource: string, exp: number, iat = exp - 900) {
  const payload = Buffer.from(JSON.stringify({ iss: "engageagent-gallery-media", aud: "http://localhost:3210", key: resource, mime: "video/mp4", iat, exp })).toString("base64url");
  return `/api/material-gallery/media?ticket=header.${payload}.signature`;
}

describe("stableMediaUrl", () => {
  it("retains a valid URL when S3 resigns the same object with different credentials", () => {
    const old = s3();
    const fresh = s3({ signedAt: now + 15_000, signature: "b" });
    expect(stableMediaUrl(old, fresh, now + 15_000)).toBe(old);
    expect(stableMediaUrl(old, fresh, now + 839_999)).toBe(old);
  });

  it.each([840_000, 899_999, 900_000, 1_200_000])("adopts a renewed URL when the old URL is near expiry or expired (%s ms)", elapsed => {
    const old = s3();
    const fresh = s3({ signedAt: now + elapsed, signature: "b" });
    expect(stableMediaUrl(old, fresh, now + elapsed)).toBe(fresh);
  });

  it.each([
    { path: "material-gallery/source/video-two.mp4" },
    { path: "media/class/task/cohort/item_video_v2.mp4" },
    { query: "versionId=new-object-version" },
    { query: "revision=2" },
    { host: "other-materials.s3.us-east-2.amazonaws.com" },
  ])("immediately adopts an actual resource or version change: %j", changes => {
    const old = s3();
    const changed = s3({ ...changes, signature: "b" });
    expect(stableMediaUrl(old, changed, now)).toBe(changed);
  });

  it("compares non-signing parameters independent of order without discarding them", () => {
    const old = s3({ query: "versionId=v1&response-content-type=video%2Fmp4" });
    const fresh = s3({ query: "response-content-type=video%2Fmp4&versionId=v1", signature: "b" });
    expect(stableMediaUrl(old, fresh, now)).toBe(old);
    const changed = s3({ query: "versionId=v2&response-content-type=video%2Fmp4", signature: "b" });
    expect(stableMediaUrl(old, changed, now)).toBe(changed);
  });

  it("does not replace a still-usable URL with an older signature near expiry", () => {
    const old = s3();
    const stale = s3({ signedAt: now - 15_000, signature: "b" });
    expect(stableMediaUrl(old, stale, now + 850_000)).toBe(old);
  });

  it("renews local Gallery tickets by expiry without confusing different resources", () => {
    const old = ticket("material-gallery/source/video-one", now / 1000 + 900);
    const fresh = ticket("material-gallery/source/video-one", now / 1000 + 915);
    const different = ticket("material-gallery/source/video-two", now / 1000 + 915);
    expect(stableMediaUrl(old, fresh, now + 15_000)).toBe(old);
    expect(stableMediaUrl(old, fresh, now + 850_000)).toBe(fresh);
    expect(stableMediaUrl(old, different, now + 15_000)).toBe(different);
  });

  it("does not treat arbitrary query strings, malformed dates or invalid tickets as renewable signatures", () => {
    const changed = "https://example.test/video.mp4?token=new";
    expect(stableMediaUrl("https://example.test/video.mp4?token=old", changed, now)).toBe(changed);
    const malformed = s3().replace("20261103T120000Z", "20260230T120000Z");
    expect(stableMediaUrl(malformed, s3({ signature: "b" }), now)).toBe(s3({ signature: "b" }));
    const invalidTicket = "/api/material-gallery/media?ticket=not.a-valid-json-payload.signature";
    expect(stableMediaUrl(invalidTicket, ticket("resource", now / 1000 + 900), now)).toBe(ticket("resource", now / 1000 + 900));
    expect(stableMediaUrl("data:video/mp4;base64,AAAA", "data:video/mp4;base64,BBBB", now)).toBe("data:video/mp4;base64,BBBB");
  });
});

describe("stableContentMedia", () => {
  it("refreshes image capabilities while preserving video playback", () => {
    const video = s3();
    const image = s3({ path: "material-gallery/source/image-one.png" });
    const incomingVideo = s3({ signedAt: now + 15_000, signature: "b" });
    const incomingImage = s3({ path: "material-gallery/source/image-one.png", signedAt: now + 15_000, signature: "b" });
    expect(stableContentMedia({ item: { image, video } }, { item: { image: incomingImage, video: incomingVideo } }, now + 15_000))
      .toEqual({ item: { image: incomingImage, video } });
  });

  it("keeps each kind and item separate and removes withdrawn items or removed media", () => {
    const video = s3();
    const image = s3({ path: "material-gallery/source/image-one.png" });
    const incomingVideo = s3({ signedAt: now + 15_000, signature: "b" });
    const result = stableContentMedia({ removed: { video }, retained: { image, video } }, { retained: { video: incomingVideo }, new: { video: incomingVideo } }, now + 15_000);
    expect(result).toEqual({ retained: { video }, new: { video: incomingVideo } });
    expect(stableContentMedia({ retained: { video } }, {}, now)).toEqual({});
  });
});

describe("sameMediaResource", () => {
  it("matches renewed S3 and local signatures to the same resource even after expiry", () => {
    expect(sameMediaResource(s3({ signedAt: now - 3_600_000 }), s3({ signature: "b" }))).toBe(true);
    expect(sameMediaResource(ticket("material-gallery/source/image-one", now / 1000 - 60), ticket("material-gallery/source/image-one", now / 1000 + 900))).toBe(true);
  });
  it("distinguishes image versions, local resource keys and unknown changing URLs", () => {
    expect(sameMediaResource(s3(), s3({ path: "media/item_image_v2.png" }))).toBe(false);
    expect(sameMediaResource(s3({ query: "versionId=v1" }), s3({ query: "versionId=v2" }))).toBe(false);
    expect(sameMediaResource(ticket("first", now / 1000 + 900), ticket("second", now / 1000 + 900))).toBe(false);
    expect(sameMediaResource("https://example.test/image?token=old", "https://example.test/image?token=new")).toBe(false);
    expect(sameMediaResource("https://example.test/image.png", "https://example.test/image.png")).toBe(true);
  });
});
