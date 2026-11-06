import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const mocks = vi.hoisted(() => ({ send: vi.fn(async () => ({})), destroy: vi.fn(), sign: vi.fn(async () => "https://signed.example/file") }));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...await original<object>(),
  S3Client: class { send = mocks.send; destroy = mocks.destroy; },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));

import { quizFileUrl, storeQuizFile } from "@/lib/task-quiz-file";

const activity = { classId: "c", assignmentId: "a" };
beforeEach(() => {
  vi.stubEnv("ENGAGE_LOCAL_MATERIAL_STORAGE", "");
  vi.stubEnv("ENGAGE_S3_BUCKET", "private-bucket");
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllEnvs(); });

it("stores under a key the client can't choose, as a private download", async () => {
  const key = await storeQuizFile(activity, "docx", '../We"ird name.docx', Buffer.from("x"));
  expect(key).toMatch(/^material-files\/task-quiz\/[a-f0-9]{64}\/[0-9a-f-]{36}\.docx$/);
  const command = (mocks.send.mock.calls[0] as unknown[])[0] as PutObjectCommand;
  expect(command).toBeInstanceOf(PutObjectCommand);
  expect(command.input).toMatchObject({ Bucket: "private-bucket", Key: key, CacheControl: "private, no-store" });
  expect(command.input.ContentDisposition).toBe('attachment; filename="-We-ird name.docx"');
  expect(mocks.destroy).toHaveBeenCalled();
});

it("gives a ten-minute download link", async () => {
  expect(await quizFileUrl({ storageKey: "k", fileName: "q.pdf", fileKind: "pdf" })).toBe("https://signed.example/file");
  const [, command, options] = mocks.sign.mock.calls[0] as unknown as [unknown, GetObjectCommand, { expiresIn: number }];
  expect(command.input).toMatchObject({ Key: "k", ResponseContentType: "application/pdf", ResponseContentDisposition: 'attachment; filename="q.pdf"' });
  expect(options.expiresIn).toBe(600);
});

it("fails when no storage is set up", async () => {
  vi.stubEnv("ENGAGE_S3_BUCKET", "");
  await expect(storeQuizFile(activity, "pdf", "q.pdf", Buffer.from("x"))).rejects.toThrow("No file storage");
  await expect(quizFileUrl({ storageKey: "k", fileName: "q.pdf", fileKind: "pdf" })).rejects.toThrow("No file storage");
});
