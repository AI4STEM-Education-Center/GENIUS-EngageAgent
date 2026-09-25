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

export type Lesson = {
  lesson_number: number;
  lesson_title: string;
  learning_objective: string;
  core_ideas: string[];
  misconceptions: Record<string, string>;
  quiz_items: QuizItem[];
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

/* ------------------------------------------------------------------ */
/*  Surveys (UC-SV-01_V1, #95)                                         */
/*  Learning Task → Survey → Questions                                 */
/*                                                                     */
/*  This is the simplified V1 shape. Fields from the richer first pass  */
/*  are kept below as comments so they can be restored in a later       */
/*  version instead of being rewritten from scratch.                    */
/* ------------------------------------------------------------------ */

/** V1 supports free-text answers only. */
export type SurveyResponseType = "short_answer" | "long_answer";
// Later version — additional response types:
// | "single_choice"
// | "multiple_choice"
// | "sentence_completion";

export type SurveyQuestionPurpose = "familiarity" | "follow_up" | "unspecified";

export type SurveyStatus = "draft" | "published";

// Later version — sentence-completion blanks:
// export type SurveyBlank = {
//   blank_id: string;
//   label: string;
// };

// Later version — multiple labelled response fields per question.
// V1 uses a single `response_type` on the question itself.
// export type SurveyResponseField = {
//   field_id: string;
//   label: string;
//   response_type: SurveyResponseType;
//   helper?: string; // example/helper text
//   data_key?: string;
//   required?: boolean;
//   options?: string[]; // single_choice / multiple_choice (>= 2)
//   sentence_text?: string; // sentence_completion
//   blanks?: SurveyBlank[]; // sentence_completion (>= 1)
// };

export type SurveyQuestion = {
  question_id: string;
  prompt: string; // required
  instructions?: string; // instructions or example, optional
  purpose: SurveyQuestionPurpose; // required
  related_concept?: string; // optional in V1
  order: number; // auto-assigned as questions are added; reorderable
  response_type: SurveyResponseType; // required
  // Later version: response_fields: SurveyResponseField[];
};

export type Survey = {
  survey_id: string;
  class_id: string;
  assignment_id: string;
  title: string; // required
  description?: string; // optional
  daily_experience_topic: string; // required
  status: SurveyStatus;
  questions: SurveyQuestion[];
  created_at: string;
  updated_at: string;
  // Later version:
  // student_instructions?: string;
  // lesson_number?: number; // related lesson
};
