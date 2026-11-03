import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopyObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), sign: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async original => ({ ...await original<object>(), S3Client: class { send = mocks.send; destroy = mocks.destroy; } }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { assertGalleryStorage, copyGalleryBlob, galleryBlobUrl, readGalleryBlob, storeGalleryBlob } from "@/lib/material-gallery-storage";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ENGAGE_S3_BUCKET", "private-project-bucket"); mocks.send.mockResolvedValue({}); mocks.sign.mockResolvedValue("https://signed.example/material?temporary=1"); });
afterEach(() => vi.unstubAllEnvs());

it("persists media privately in the configured bucket, without a public ACL or source class identifier", async () => {
  const key = "material-gallery/immutable-id/image-checksum";
  const saved = await storeGalleryBlob(key, Buffer.from("an image"), "image/png");
  expect(mocks.send).toHaveBeenCalledOnce();
  const command = mocks.send.mock.calls[0][0]; expect(command).toBeInstanceOf(PutObjectCommand);
  expect(command.input).toMatchObject({ Bucket: "private-project-bucket", Key: key, ContentType: "image/png", CacheControl: "private, no-store" });
  expect(command.input.ACL).toBeUndefined(); expect(saved.digest).toMatch(/^[a-f0-9]{64}$/); expect(mocks.destroy).toHaveBeenCalledOnce();
});
it("fails closed rather than writing production data to ephemeral local disk when cloud storage is absent", () => {
  vi.stubEnv("ENGAGE_S3_BUCKET", "");
  expect(() => assertGalleryStorage()).toThrow("private cloud storage"); expect(mocks.send).not.toHaveBeenCalled();
});
it("copies only from the project's own saved bucket and safely encodes the provider key", async () => {
  await expect(copyGalleryBlob("material-gallery/id/video-copy", { bucket: "someone-else", key: "secret", mime: "video/mp4" })).rejects.toThrow("project's saved media storage");
  expect(mocks.send).not.toHaveBeenCalled();
  await copyGalleryBlob("material-gallery/id/video-copy", { bucket: "private-project-bucket", key: "media/class name/video#1.mp4", mime: "video/mp4" });
  const command = mocks.send.mock.calls[0][0]; expect(command).toBeInstanceOf(CopyObjectCommand);
  expect(command.input).toMatchObject({ Bucket: "private-project-bucket", Key: "material-gallery/id/video-copy", CopySource: "private-project-bucket/media/class%20name/video%231.mp4", MetadataDirective: "REPLACE", CacheControl: "private, no-store" });
});
it("mints fresh short-lived media URLs and bounds image downloads", async () => {
  const blob = { key: "material-gallery/id/asset-checksum", mime: "image/png", digest: "checksum", bytes: 10 };
  expect(await galleryBlobUrl(blob)).toBe("https://signed.example/material?temporary=1");
  expect(mocks.sign.mock.calls[0][1]).toBeInstanceOf(GetObjectCommand);
  expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 900 });
  mocks.send.mockResolvedValue({ ContentLength: 90_000_000, Body: { transformToByteArray: vi.fn() } });
  await expect(readGalleryBlob(blob)).rejects.toThrow("too large");
});
