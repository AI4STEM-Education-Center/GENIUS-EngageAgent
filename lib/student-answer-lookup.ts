import { scopedClientAuthHeaders } from "@/lib/client-auth";
import { findTestStudentByEmail } from "@/lib/test-students";

type ExistingAnswer = {
  answers: Record<string, string>;
};

type LookupInput = {
  classId: string;
  assignmentId: string;
  lessonNumber: number;
  userId: string;
  email?: string | null;
  fetchImpl?: typeof fetch;
};

type LookupResult = {
  answer: ExistingAnswer;
  matchedStudentId: string;
};

const buildAnswerUrl = (
  classId: string,
  assignmentId: string,
  studentId: string,
  lessonNumber: number,
) =>
  `/api/student-answers?classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(studentId)}&lessonNumber=${encodeURIComponent(lessonNumber)}`;

export const getCandidateStudentIds = (
  userId: string,
  email?: string | null,
) => {
  const candidateIds = [userId];
  const testStudent = findTestStudentByEmail(email);

  if (testStudent && testStudent.id !== userId) {
    candidateIds.push(testStudent.id);
  }

  return candidateIds;
};

export async function findExistingStudentAnswer({
  classId,
  assignmentId,
  lessonNumber,
  userId,
  email,
  fetchImpl = fetch,
}: LookupInput): Promise<LookupResult | null> {
  const headers = scopedClientAuthHeaders({ classId, assignmentId });
  const candidateIds = classId.startsWith("ea-class-") || headers.Authorization
    ? [userId] : getCandidateStudentIds(userId, email);

  for (const studentId of candidateIds) {
    const response = await fetchImpl(
      buildAnswerUrl(classId, assignmentId, studentId, lessonNumber),
      { headers, cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        (data as { error?: string }).error ?? "Failed to load existing answers.",
      );
    }

    const answer = (data as { answer?: ExistingAnswer | null }).answer ?? null;
    if (answer) {
      return { answer, matchedStudentId: studentId };
    }
  }

  return null;
}
