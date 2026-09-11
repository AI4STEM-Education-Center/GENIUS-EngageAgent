import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { sessionUser } from "@/lib/session";
import { isWorkspaceClass, listWorkspaceClasses } from "@/lib/workspace";
import {
  listAllTeacherAnnotations,
  listAllStudentAnswers,
  listAllCachedPlans,
  listAllPublishedContent,
  listAllContentRatings,
} from "@/lib/nosql";

export const maxDuration = 60;

type MonthSummary = {
  month: string;
  annotations: number;
  studentAnswers: number;
  strategyPlans: number;
  publishedContent: number;
  contentRatings: number;
  total: number;
};

function getMonthKey(isoDate: string): string | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  if (!Number.isFinite(parsed)) return null;
  const d = new Date(parsed);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month");
  const format = searchParams.get("format") ?? "json";

  const [allAnnotations, allStudentAnswers, allPlans, allPublished, allRatings] =
    await Promise.all([
      listAllTeacherAnnotations(),
      listAllStudentAnswers(),
      listAllCachedPlans(),
      listAllPublishedContent(),
      listAllContentRatings(),
    ]);

  // Legacy exports keep their existing behavior; independent classes are private to their teacher.
  const user = await sessionUser();
  const accessible = new Set(user?.role === "teacher" ? (await listWorkspaceClasses(user)).map(c => c.id) : []);
  const visible = (raw: string | undefined) => {
    const id = raw?.replace(/^CLASS#/, "");
    return !isWorkspaceClass(id) || accessible.has(id);
  };
  const annotations = allAnnotations.filter(row => visible(row.workspace_class_id));
  const studentAnswers = allStudentAnswers.filter(row => visible(row.class_id));
  const plans = allPlans.filter(row => visible(row.class_id));
  const published = allPublished.filter(row => visible(row.class_id));
  const ratings = allRatings.filter(row => visible(row.class_id));

  if (!month) {
    const summaryMap = new Map<string, MonthSummary>();

    const ensure = (key: string | null) => {
      if (!key) return null;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          month: key,
          annotations: 0,
          studentAnswers: 0,
          strategyPlans: 0,
          publishedContent: 0,
          contentRatings: 0,
          total: 0,
        });
      }
      return summaryMap.get(key)!;
    };

    for (const a of annotations) {
      const entry = ensure(getMonthKey(a.created_at));
      if (entry) { entry.annotations++; entry.total++; }
    }
    for (const a of studentAnswers) {
      const entry = ensure(getMonthKey(a.submitted_at));
      if (entry) { entry.studentAnswers++; entry.total++; }
    }
    for (const p of plans) {
      const entry = ensure(getMonthKey(p.updated_at));
      if (entry) { entry.strategyPlans++; entry.total++; }
    }
    for (const p of published) {
      const entry = ensure(getMonthKey(p.published_at));
      if (entry) { entry.publishedContent++; entry.total++; }
    }
    for (const r of ratings) {
      const entry = ensure(getMonthKey(r.rated_at));
      if (entry) { entry.contentRatings++; entry.total++; }
    }

    const months = Array.from(summaryMap.values()).sort(
      (a, b) => b.month.localeCompare(a.month),
    );

    return NextResponse.json({ months });
  }

  // Filter data to the requested month
  const inMonth = (date: string) => getMonthKey(date) === month;

  const monthAnnotations = annotations.filter((a) => inMonth(a.created_at));
  const monthAnswers = studentAnswers.filter((a) => inMonth(a.submitted_at));
  const monthPlans = plans.filter((p) => inMonth(p.updated_at));
  const monthPublished = published.filter((p) => inMonth(p.published_at));
  const monthRatings = ratings.filter((r) => inMonth(r.rated_at));

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();

    // Annotations sheet
    const annotationRows = monthAnnotations.map((a) => ({
      "Annotation ID": a.annotation_id,
      "Student Name": a.student_name ?? "",
      Assignment: a.assignment ?? "",
      Decision: a.decision,
      Reason: a.reason ?? "",
      "Overall Recommendation": a.overall_recommendation,
      "Recommendation Reason": a.recommendation_reason ?? "",
      "Selected Strategies": a.selected_strategies.join(", "),
      "Created At": a.created_at,
    }));
    const wsAnnotations = XLSX.utils.json_to_sheet(
      annotationRows.length > 0 ? annotationRows : [{ "No data": "" }],
    );
    XLSX.utils.book_append_sheet(wb, wsAnnotations, "Annotations");

    // Student Answers sheet
    const answerRows = monthAnswers.map((a) => ({
      "Class ID": a.class_id,
      "Assignment ID": a.assignment_id,
      "Student ID": a.student_id,
      "Student Name": a.student_name,
      "Lesson Number": a.lesson_number,
      Answers: JSON.stringify(a.answers),
      "Submitted At": a.submitted_at,
    }));
    const wsAnswers = XLSX.utils.json_to_sheet(
      answerRows.length > 0 ? answerRows : [{ "No data": "" }],
    );
    XLSX.utils.book_append_sheet(wb, wsAnswers, "Student Answers");

    // Strategy Plans sheet
    const planRows = monthPlans.map((p) => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(p.plan_json); } catch { /* skip */ }
      return {
        "Class ID": p.class_id,
        "Assignment ID": p.assignment_id,
        "Student ID": p.student_id,
        Strategy: (parsed as { strategy?: string }).strategy ?? "",
        Name: (parsed as { name?: string }).name ?? "",
        Summary: (parsed as { summary?: string }).summary ?? "",
        "TL;DR": (parsed as { tldr?: string }).tldr ?? "",
        "Updated At": p.updated_at,
      };
    });
    const wsPlans = XLSX.utils.json_to_sheet(
      planRows.length > 0 ? planRows : [{ "No data": "" }],
    );
    XLSX.utils.book_append_sheet(wb, wsPlans, "Strategy Plans");

    // Published Content sheet
    const publishedRows = monthPublished.map((p) => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(p.content_json); } catch { /* skip */ }
      return {
        "Class ID": p.class_id,
        "Assignment ID": p.assignment_id,
        "Content Item ID": p.content_item_id,
        Title: (parsed as { title?: string }).title ?? "",
        Type: (parsed as { type?: string }).type ?? "",
        Strategy: (parsed as { strategy?: string }).strategy ?? "",
        "Published By": p.published_by,
        "Published At": p.published_at,
      };
    });
    const wsPublished = XLSX.utils.json_to_sheet(
      publishedRows.length > 0 ? publishedRows : [{ "No data": "" }],
    );
    XLSX.utils.book_append_sheet(wb, wsPublished, "Published Content");

    // Content Ratings sheet
    const ratingRows = monthRatings.map((r) => ({
      "Class ID": r.class_id,
      "Assignment ID": r.assignment_id,
      "Student ID": r.student_id,
      "Content Item ID": r.content_item_id,
      Rating: r.rating,
      "Rated At": r.rated_at,
    }));
    const wsRatings = XLSX.utils.json_to_sheet(
      ratingRows.length > 0 ? ratingRows : [{ "No data": "" }],
    );
    XLSX.utils.book_append_sheet(wb, wsRatings, "Content Ratings");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="engage-data-${month}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    month,
    annotations: monthAnnotations,
    studentAnswers: monthAnswers,
    strategyPlans: monthPlans,
    publishedContent: monthPublished,
    contentRatings: monthRatings,
  });
}
