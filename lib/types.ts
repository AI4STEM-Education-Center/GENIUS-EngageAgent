export type Answers = Record<string, string>;

export type Plan = {
  name: string;
  strategy: string;
  relevance: Record<string, number>;
  overallRecommendation: string;
  recommendationReason: string;
  summary: string;
  tldr: string;
  rationale: string;
  tactics: string[];
  cadence: string;
  checks: string[];
};

export type TextMode = "questions" | "phenomenon" | "dialogue";

export type ContentItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  strategy: string;
  textModes?: TextMode[];
  visualBrief?: string;
};

export type ImageVersion = {
  url: string;
  refinementPrompt?: string;
  createdAt: string;
};

export type ImageState = {
  status: "idle" | "loading" | "ready" | "error";
  url?: string;
  error?: string;
  history?: ImageVersion[];
  historyIndex?: number;
};

export type VideoState = {
  status: "idle" | "loading" | "polling" | "ready" | "error";
  url?: string;
  error?: string;
  operationName?: string;
};

export type StudentStrategyResult = {
  id: string;
  name: string;
  plan: Plan;
};

export type QuizItem = {
  item_id: string;
  type: "multiple_choice" | "confidence_check";
  question_number?: number;
  stem: string;
  options: Record<string, string>;
  correct_answer?: string;
  matched_misconception?: string;
  distractor_misconception_map?: Partial<Record<string, string>>;
};

export type SurveyResponseField = {
  field_id: string;
  label: string;
  response_type: "text" | "choice";
  options?: string[];
  /**
   * For "text" responses, how much room the student gets.
   * Teacher-authored surveys (UC-SV-01_V1) expose this as
   * "Short answer" / "Long answer". Defaults to "short".
   */
  text_length?: "short" | "long";
};

export type SurveyItem = {
  item_id: string;
  question_number: number;
  /**
   * Question purpose. "familiarity" and "experience_details" come from the
   * built-in beginning-of-lesson surveys; "follow_up" and "unspecified" are
   * used by teacher-authored surveys (UC-SV-01_V1).
   */
  category:
    | "familiarity"
    | "experience_details"
    | "follow_up"
    | "unspecified";
  stem: string;
  example?: string;
  /** Related concept or phenomenon (optional in UC-SV-01_V1). */
  related_concept?: string;
  response_fields: SurveyResponseField[];
};

export type Lesson = {
  lesson_number: number;
  lesson_title: string;
  learning_objective: string;
  core_ideas: string[];
  misconceptions: Record<string, string>;
  quiz_items: QuizItem[];
  survey_items: SurveyItem[];
};

export type QuizStatus = "draft" | "published" | "closed";

export type StudentAnswer = {
  student_id: string;
  student_name: string;
  class_id: string;
  assignment_id: string;
  lesson_number: number;
  answers: Record<string, string>; // item_id → selected option (e.g., "A")
  submitted_at: string;
};

export type ContentPublishRecord = {
  class_id: string;
  assignment_id: string;
  content_item_id: string;
  published: boolean;
  published_at: string;
  published_by: string;
};

export type ContentRatingRecord = {
  class_id: string;
  assignment_id: string;
  student_id: string;
  content_item_id: string;
  rating: number; // 1-5
  rated_at: string;
};

export type ReviewQuestionRecord = {
  class_id: string;
  assignment_id: string;
  student_id: string;
  questions: string[];
  submitted_at: string;
};

/* ------------------------------------------------------------------ */
/*  Teacher-authored surveys (UC-SV-01_V1, #95)                        */
/*                                                                     */
/*  These reuse the SurveyItem / SurveyResponseField shapes above so    */
/*  there is a single survey model shared with the built-in            */
/*  beginning-of-lesson surveys.                                       */
/* ------------------------------------------------------------------ */

/**
 * "draft"     — not published yet.
 * "scheduled" — published with a publish time still in the future (UC-SV-03).
 * "published" — open to students.
 * "closed"    — past the due time and late submissions are not allowed.
 *
 * "scheduled" and "closed" are derived from the schedule rather than set by
 * hand; see resolveSurveyStatus in lib/survey-schedule.
 */
export type SurveyStatus = "draft" | "scheduled" | "published" | "closed";

/** Publish settings for a survey (UC-SV-03, #80). */
export type SurveySchedule = {
  publish_at: string; // ISO timestamp
  due_at: string; // ISO timestamp
  allow_late_submissions: boolean;
  allow_response_editing: boolean;
  show_immediately: boolean;
};

export type Survey = {
  survey_id: string;
  class_id: string;
  assignment_id: string;
  title: string; // required
  description?: string; // optional
  daily_experience_topic: string; // required
  status: SurveyStatus;
  questions: SurveyItem[];
  /** Set once the survey has been published or scheduled (UC-SV-03). */
  schedule?: SurveySchedule;
  published_by?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
};
