import { notFound } from "next/navigation";
import LessonEditor from "@/app/components/lessons/LessonEditor";

export default async function EditLesson({ params }: { params: Promise<{ lessonNumber: string }> }) {
  const { lessonNumber } = await params;
  if (!/^[1-9]\d{0,5}$/.test(lessonNumber)) notFound();
  return <LessonEditor lessonNumber={Number(lessonNumber)} />;
}
