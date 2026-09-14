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
};

export type SurveyItem = {
  item_id: string;
  question_number: number;
  category: "familiarity" | "experience_details";
  stem: string;
  example?: string;
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
