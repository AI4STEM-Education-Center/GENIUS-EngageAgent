import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { GET as ratings, POST as rate } from "@/app/api/content-rating/route";
import { GET as questions } from "@/app/api/review-questions/route";
import { GET as activity } from "@/app/api/activity-status/route";
import { GET as surveys } from "@/app/api/surveys/route";
const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), quiz: vi.fn(), statuses: vi.fn(), list: vi.fn(), save: vi.fn(), published: vi.fn(), surveys: vi.fn(), survey: vi.fn() }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (r: Request) => r.headers.get("origin") === "https://engageagent.ai4genius.org" }));
vi.mock("@/lib/workspace", async original => ({ ...await original<typeof import("@/lib/workspace")>(), workspaceContext: mocks.context }));
vi.mock("@/lib/activity-status", () => ({ computeActivityStatuses: mocks.statuses, ACTIVITIES: [{ id: "content-review", order: 2 }] }));
vi.mock("@/lib/nosql", () => ({ getQuizStatus: mocks.quiz, listContentRatings: mocks.list, upsertContentRating: mocks.save, listPublishedContent: mocks.published, listReviewQuestions: mocks.list, listSurveys: mocks.surveys, getSurvey: mocks.survey }));
const scope = { classId: "6acd5bcc5aab56222c7b5ad5", assignmentId: "6acd5bf55aab56222c7b5afe" };
const host = "https://engageagent.ai4genius.org";
async function token(extra = {}, secret = "audit-secret") {
  return new SignJWT({ sub: "student-1", role: "student", name: "Student", email: null, ...scope, aud: "engageagent-embed", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300, ...extra }).setProtectedHeader({alg:"HS256"}).setIssuer("genius-learning-platform").sign(new TextEncoder().encode(secret));
}
function request(path: string, bearer?: string, method = "GET", extra: Record<string, unknown> = {}) {
  const fields = { ...scope, studentId: "student-1", ...extra };
  return new Request(`${host}/api/${path}${method === "GET" ? `?${new URLSearchParams(fields as Record<string,string>)}` : ""}`, {
    method, headers: { origin: host, "content-type": "application/json", ...(bearer === undefined ? {} : {authorization: `Bearer ${bearer}`}) }, ...(method === "GET" ? {} : {body: JSON.stringify(fields)}),
  });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("SSO_SECRET", "audit-secret"); mocks.session.mockResolvedValue(null); mocks.quiz.mockResolvedValue({status:"published", lesson_number:8}); mocks.statuses.mockResolvedValue({"content-review":"available","content-rating":"available"}); mocks.published.mockResolvedValue([{content_item_id:"deck-1"}]); mocks.list.mockResolvedValue([]); mocks.save.mockImplementation(async x=>x); });
afterEach(()=>vi.unstubAllEnvs());
describe("GENIUS workflow authorization", () => {
  it("rejects anonymous rating, question and activity reads before storage", async()=>{
    for(const [handler,path] of [[ratings,"content-rating"],[questions,"review-questions"],[activity,"activity-status"]] as const) expect((await handler(request(path))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.statuses).not.toHaveBeenCalled();
  });
  it("accepts only signed own-assignment and own-student feedback", async()=>{
    const bearer=await token(); expect((await ratings(request("content-rating",bearer))).status).toBe(200);
    expect((await ratings(request("content-rating",bearer,"GET",{studentId:"another"}))).status).toBe(403);
    expect((await ratings(request("content-rating",bearer,"GET",{assignmentId:"other"}))).status).toBe(403);
    expect((await ratings(request("content-rating",bearer,"GET",{classId:"other"}))).status).toBe(403);
  });
  it("does not fall back to a native teacher cookie for invalid embedded credentials", async()=>{
    mocks.session.mockResolvedValue({geniusId:"teacher",role:"teacher"});
    for(const bearer of ["invalid",await token({},"wrong"),await token({aud:"legacy"}),await token({exp:1})]) expect((await ratings(request("content-rating",bearer))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("lets a scoped teacher aggregate feedback but never submit as a student", async()=>{
    const bearer=await token({sub:"teacher-1",role:"teacher"});
    expect((await ratings(request("content-rating",bearer))).status).toBe(200);
    expect((await rate(request("content-rating",bearer,"POST",{contentItemId:"deck-1",rating:4}))).status).toBe(403);
  });
  it("prevents students generating, publishing, and reading teacher diagnostics", async()=>{
    const bearer=await token();
    for(const path of ["content-publish","quiz-status","engagement-content","engagement-image","media","surveys/publish"]) expect((await guardWorkspaceRequest(request(path,bearer,"POST")))?.status).toBe(403);
    for(const path of ["strategy-cache","engagement-video/status"]) expect((await guardWorkspaceRequest(request(path,bearer)))?.status).toBe(403);
  });
  it("checks quiz availability and signed identity before accepting quiz responses", async()=>{
    const bearer=await token(); const fields={studentName:"Student",lessonNumber:8};
    expect(await guardWorkspaceRequest(request("student-answers",bearer,"POST",fields))).toBeNull();
    expect((await guardWorkspaceRequest(request("student-answers",bearer,"POST",{...fields,studentName:"Spoofed"})))?.status).toBe(403);
    expect((await guardWorkspaceRequest(request("student-answers",bearer,"POST",{...fields,lessonNumber:7})))?.status).toBe(409);
  });
  it("allows own survey responses, denies other students, and blocks cross-origin writes", async()=>{
    const bearer=await token(); expect(await guardWorkspaceRequest(request("surveys",bearer))).toBeNull();
    expect(await guardWorkspaceRequest(request("survey-responses",bearer,"POST",{studentName:"Student"}))).toBeNull();
    expect((await guardWorkspaceRequest(request("survey-responses",bearer,"GET",{studentId:"other"})))?.status).toBe(403);
    const req=request("content-rating",bearer,"POST",{contentItemId:"deck-1",rating:4});req.headers.set("origin","https://other.example");expect((await rate(req)).status).toBe(403);
  });
  it("accepts an integer rating for published content only and retains the activity gate", async()=>{
    const bearer=await token();
    expect((await rate(request("content-rating",bearer,"POST",{contentItemId:"deck-1",rating:4}))).status).toBe(201);
    expect((await rate(request("content-rating",bearer,"POST",{contentItemId:"foreign",rating:4}))).status).toBe(404);
    expect((await rate(request("content-rating",bearer,"POST",{contentItemId:"deck-1",rating:4.5}))).status).toBe(400);
    mocks.statuses.mockResolvedValue({"content-rating":"locked"});expect((await rate(request("content-rating",bearer,"POST",{contentItemId:"deck-1",rating:4}))).status).toBe(409);
  });
  it("allows signed GENIUS guests only their assigned student workflow and hides draft surveys", async () => {
    const bearer = await token({ role: "guest" });
    expect((await ratings(request("content-rating", bearer))).status).toBe(200);
    expect(await guardWorkspaceRequest(request("student-answers", bearer, "POST", { studentName: "Student", lessonNumber: 8 }))).toBeNull();
    expect((await rate(request("content-rating", bearer, "POST", { contentItemId: "deck-1", rating: 4 }))).status).toBe(201);
    expect((await ratings(request("content-rating", bearer, "GET", { studentId: "another" }))).status).toBe(403);
    expect((await ratings(request("content-rating", bearer, "GET", { classId: "another-class" }))).status).toBe(403);
    expect((await guardWorkspaceRequest(request("content-publish", bearer, "POST")))?.status).toBe(403);
    mocks.surveys.mockResolvedValue([{ survey_id: "draft", status: "draft" }, { survey_id: "visible", status: "published" }]);
    const surveyResponse = await surveys(request("surveys", bearer));
    expect(surveyResponse.status).toBe(200);
    expect((await surveyResponse.json()).surveys).toEqual([{ survey_id: "visible", status: "published" }]);
    mocks.survey.mockResolvedValue({ survey_id: "draft", status: "draft" });
    expect((await surveys(request("surveys", bearer, "GET", { surveyId: "draft" }))).status).toBe(404);
    // An unrelated native guest cookie cannot substitute for a signed launch.
    mocks.session.mockResolvedValue({ geniusId: "student-1", role: "guest" });
    expect((await ratings(request("content-rating"))).status).toBe(401);
    expect((await ratings(request("content-rating", undefined, "GET", { classId: "ea-class-a", assignmentId: "ea-task-a" }))).status).toBe(403);
  });

  it("rejects duplicate scope and student parameters before signed authorization can disagree with handler parsing", async () => {
    const bearer = await token();
    for (const [field, foreign] of [["classId", "foreign-class"], ["assignmentId", "foreign-task"], ["studentId", "victim"]]) {
      const url = new URL(request("content-rating", bearer).url);
      const own = url.searchParams.get(field)!;
      url.searchParams.delete(field);
      url.searchParams.append(field, foreign);
      url.searchParams.append(field, own);
      const response = await ratings(new Request(url, { headers: { authorization: `Bearer ${bearer}` } }));
      expect(response.status).toBe(400);
    }
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });

});
