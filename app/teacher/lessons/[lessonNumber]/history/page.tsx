import { notFound } from "next/navigation";
import LessonHistory from "@/app/components/lessons/LessonHistory";

export default async function LessonHistoryPage({ params }: { params: Promise<{ lessonNumber: string }> }) {
  const { lessonNumber } = await params;
  if (!/^[1-9]\d{0,5}$/.test(lessonNumber)) notFound();
  return <LessonHistory lessonNumber={Number(lessonNumber)} />;
}
