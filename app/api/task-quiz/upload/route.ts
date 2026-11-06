import { fileImportMessage, NO_ITEMS_MESSAGE, taskQuizView } from "@/lib/task-quiz";
import { extractQuizItems, quizAiClient, QuizAiError } from "@/lib/task-quiz-ai";
import { guardQuizUpload, quizActivityFromUrl, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { cleanQuizFileName, FILE_TOO_LARGE_MESSAGE, QuizFileTooLarge, readQuizFile, readQuizUpload, storeQuizFile, UnsupportedQuizFile } from "@/lib/task-quiz-file";
import { prepareQuizReplace, replaceQuizItems } from "@/lib/task-quiz-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST ?classId&assignmentId&fileName[&confirmReplace=1], with the file as the
 * raw request body (UC 4.2). The quiz and storage only change after everything
 * has worked, so any failure leaves the previous quiz in place.
 */
export async function POST(request: Request) {
  const denied = await guardQuizUpload(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const activity = quizActivityFromUrl(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => !["classId", "assignmentId", "fileName", "confirmReplace"].includes(key))) return quizJson({ error: "Invalid upload parameters." }, 400);
    const encoding = request.headers.get("content-encoding");
    if (encoding && encoding !== "identity") return quizJson({ error: "Send the file as it is, without compressing it." }, 415);
    const fileName = cleanQuizFileName(params.get("fileName"));
    if (!fileName) return quizJson({ error: "Choose a file with a valid name." }, 400);
    const confirmReplace = params.get("confirmReplace") === "1";
    await prepareQuizReplace(activity, "uploaded", confirmReplace);

    let bytes: Buffer;
    try {
      bytes = await readQuizUpload(request);
    } catch (error) {
      if (error instanceof QuizFileTooLarge) return quizJson({ error: FILE_TOO_LARGE_MESSAGE }, 413);
      throw error;
    }
    const noItems = () => quizJson({ error: NO_ITEMS_MESSAGE(fileName) }, 422);
    let file;
    try {
      file = await readQuizFile(bytes, fileName);
    } catch (error) {
      if (error instanceof UnsupportedQuizFile) return noItems();
      throw error;
    }
    const client = quizAiClient();
    if (!client) return quizJson({ error: `Couldn't read ${fileName} — try again` }, 503);
    let items;
    try {
      items = await extractQuizItems(client, file.document);
    } catch (error) {
      if (error instanceof QuizAiError) {
        console.error("Quiz file read failed");
        return quizJson({ error: `Couldn't read ${fileName} — try again` }, 502);
      }
      throw error;
    }
    if (!items.length) return noItems();
    let storageKey: string;
    try {
      storageKey = await storeQuizFile(activity, file.kind, fileName, bytes);
    } catch (error) {
      console.error("Quiz file storage failed", { type: error instanceof Error ? error.name : "Unknown" });
      return quizJson({ error: `Couldn't save ${fileName} — try again` }, 503);
    }
    const quiz = await replaceQuizItems(user, activity, {
      source: "uploaded", items, confirmReplace,
      sourceDetail: { kind: "file", fileName, fileKind: file.kind, bytes: bytes.length, storageKey, at: new Date().toISOString() },
    });
    return quizJson({ message: fileImportMessage(items, fileName), quiz: taskQuizView(quiz) });
  } catch (error) { return quizFailure(error); }
}
