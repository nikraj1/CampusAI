-- CampusAI baseline schema (see docs/BLUEPRINT.md section 7)
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ai;

-- ---------- identity ----------
CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  full_name varchar(120) NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT','ADMIN')),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LOCKED','DELETED')),
  failed_login_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid,
  user_agent varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_refresh_user ON app.refresh_tokens(user_id);
CREATE INDEX ix_refresh_family ON app.refresh_tokens(family_id);

CREATE TABLE app.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  college varchar(160),
  degree varchar(80),
  branch varchar(80),
  graduation_year smallint,
  target_role varchar(120),
  experience_level varchar(16) CHECK (experience_level IN ('FRESHER','INTERN','JUNIOR')),
  preferences jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- study ----------
CREATE TABLE app.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  description text,
  color varchar(9),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE app.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES app.subjects(id) ON DELETE SET NULL,
  purpose varchar(16) NOT NULL CHECK (purpose IN ('STUDY','RESUME')),
  title varchar(255) NOT NULL,
  original_filename varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 char(64) NOT NULL,
  storage_key varchar(512) NOT NULL,
  page_count int,
  status varchar(16) NOT NULL CHECK (status IN ('UPLOADED','PROCESSING','READY','FAILED','DELETING')),
  error_message varchar(500),
  ocr_pages int NOT NULL DEFAULT 0,
  chunk_count int NOT NULL DEFAULT 0,
  embedding_model varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sha256, purpose)
);
CREATE INDEX ix_documents_user ON app.documents(user_id, purpose, created_at DESC);
CREATE INDEX ix_documents_subject ON app.documents(subject_id);

CREATE TABLE app.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES app.topics(id) ON DELETE CASCADE,
  title varchar(255) NOT NULL,
  level smallint NOT NULL,
  order_index int NOT NULL,
  page_start int NOT NULL,
  page_end int NOT NULL,
  summary text,
  summary_model varchar(80)
);
CREATE INDEX ix_topics_doc ON app.topics(document_id, order_index);
CREATE INDEX ix_topics_user ON app.topics(user_id);

CREATE TABLE app.quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES app.subjects(id) ON DELETE SET NULL,
  title varchar(200) NOT NULL,
  difficulty varchar(16) NOT NULL CHECK (difficulty IN ('EASY','MEDIUM','HARD','ADAPTIVE')),
  source_scope jsonb NOT NULL DEFAULT '{}',
  status varchar(16) NOT NULL CHECK (status IN ('GENERATING','READY','FAILED')),
  question_count smallint NOT NULL DEFAULT 0,
  error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_quizzes_user ON app.quizzes(user_id, created_at DESC);

CREATE TABLE app.quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES app.quizzes(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES app.topics(id) ON DELETE SET NULL,
  order_index smallint NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('MCQ_SINGLE','MCQ_MULTI','TRUE_FALSE')),
  stem text NOT NULL,
  options jsonb NOT NULL,
  correct_indices smallint[] NOT NULL,
  explanation text NOT NULL,
  difficulty varchar(8) NOT NULL,
  bloom_level varchar(16),
  source_refs jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX ix_qq_quiz ON app.quiz_questions(quiz_id, order_index);

CREATE TABLE app.quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES app.quizzes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  score smallint,
  max_score smallint,
  duration_seconds int
);
CREATE INDEX ix_qa_user ON app.quiz_attempts(user_id, submitted_at DESC);

CREATE TABLE app.quiz_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES app.quiz_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES app.quiz_questions(id) ON DELETE CASCADE,
  selected_indices smallint[] NOT NULL,
  is_correct boolean NOT NULL,
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE app.topic_mastery (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES app.topics(id) ON DELETE CASCADE,
  mastery numeric(4,3) NOT NULL DEFAULT 0.5,
  attempts int NOT NULL DEFAULT 0,
  correct int NOT NULL DEFAULT 0,
  last_practiced_at timestamptz,
  PRIMARY KEY (user_id, topic_id)
);
CREATE INDEX ix_mastery_user ON app.topic_mastery(user_id, mastery);

-- ---------- career ----------
CREATE TABLE app.user_skills (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  skill varchar(100) NOT NULL,
  category varchar(40),
  proficiency smallint,
  source varchar(16) NOT NULL CHECK (source IN ('RESUME','SELF','ROADMAP')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill)
);

CREATE TABLE app.resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL UNIQUE REFERENCES app.documents(id) ON DELETE CASCADE,
  label varchar(100),
  is_primary boolean NOT NULL DEFAULT false,
  parse_status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (parse_status IN ('PENDING','PARSED','FAILED')),
  raw_text text,
  parsed jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_resume_primary ON app.resumes(user_id) WHERE is_primary;

CREATE TABLE app.job_descriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title varchar(160),
  company varchar(160),
  raw_text text NOT NULL,
  parsed jsonb,
  source_url varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.resume_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  resume_id uuid NOT NULL REFERENCES app.resumes(id) ON DELETE CASCADE,
  job_description_id uuid REFERENCES app.job_descriptions(id) ON DELETE SET NULL,
  type varchar(16) NOT NULL CHECK (type IN ('GENERAL','JD_MATCH')),
  overall_score smallint,
  match_score smallint,
  result jsonb NOT NULL,
  model_used varchar(80),
  prompt_version varchar(80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_analyses_user ON app.resume_analyses(user_id, created_at DESC);

CREATE TABLE app.career_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES app.resume_analyses(id) ON DELETE SET NULL,
  target_role varchar(120) NOT NULL,
  duration_weeks smallint NOT NULL,
  hours_per_week smallint NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.roadmap_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES app.career_roadmaps(id) ON DELETE CASCADE,
  week_no smallint NOT NULL,
  order_index smallint NOT NULL,
  title varchar(200) NOT NULL,
  description text,
  skill varchar(100),
  resources jsonb NOT NULL DEFAULT '[]',
  linked_topic_ids uuid[] NOT NULL DEFAULT '{}',
  status varchar(16) NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','IN_PROGRESS','DONE')),
  completed_at timestamptz
);
CREATE INDEX ix_roadmap_items ON app.roadmap_items(roadmap_id, week_no, order_index);

CREATE TABLE app.interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  type varchar(16) NOT NULL CHECK (type IN ('TECHNICAL','HR','MIXED')),
  target_role varchar(120),
  job_description_id uuid REFERENCES app.job_descriptions(id) ON DELETE SET NULL,
  resume_id uuid REFERENCES app.resumes(id) ON DELETE SET NULL,
  difficulty varchar(8),
  planned_questions smallint NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED','ABANDONED')),
  overall_score smallint,
  report jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE app.interview_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES app.interview_sessions(id) ON DELETE CASCADE,
  order_index smallint NOT NULL,
  parent_id uuid REFERENCES app.interview_questions(id) ON DELETE CASCADE,
  category varchar(40),
  question text NOT NULL,
  answer text,
  scores jsonb,
  feedback text,
  asked_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);
CREATE INDEX ix_iq_session ON app.interview_questions(session_id, order_index);

-- ---------- project ----------
CREATE TABLE app.repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  full_name varchar(200) NOT NULL,
  html_url varchar(300) NOT NULL,
  branch varchar(100),
  is_private boolean NOT NULL DEFAULT false,
  index_status varchar(16) NOT NULL CHECK (index_status IN ('QUEUED','INDEXING','READY','FAILED','DELETING')),
  last_indexed_commit char(40),
  indexed_at timestamptz,
  file_count int NOT NULL DEFAULT 0,
  chunk_count int NOT NULL DEFAULT 0,
  languages jsonb NOT NULL DEFAULT '{}',
  detected_stack jsonb NOT NULL DEFAULT '{}',
  summary text,
  error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, full_name, branch)
);

-- ---------- conversations & jobs ----------
CREATE TABLE app.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  module varchar(16) NOT NULL CHECK (module IN ('GENERAL','STUDY','CAREER','PROJECT')),
  title varchar(200),
  scope jsonb NOT NULL DEFAULT '{}',
  summary text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_conv_user ON app.conversations(user_id, module, updated_at DESC);

CREATE TABLE app.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL CHECK (role IN ('USER','ASSISTANT')),
  content text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'COMPLETE' CHECK (status IN ('COMPLETE','STREAMING','INCOMPLETE','ERROR')),
  citations jsonb NOT NULL DEFAULT '[]',
  run_id uuid,
  agent varchar(16),
  grounded boolean,
  feedback smallint,
  feedback_comment varchar(500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_messages_conv ON app.messages(conversation_id, created_at);

CREATE TABLE app.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  queue varchar(16) NOT NULL CHECK (queue IN ('AI_INGEST','API_TASK')),
  type varchar(32) NOT NULL,
  resource_type varchar(32),
  resource_id uuid,
  status varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  stage varchar(32),
  progress smallint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}',
  result jsonb,
  error_message varchar(1000),
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  priority smallint NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_by varchar(64),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_jobs_queued ON app.jobs(queue, priority, created_at) WHERE status = 'QUEUED';
CREATE INDEX ix_jobs_resource ON app.jobs(resource_type, resource_id);
CREATE INDEX ix_jobs_user ON app.jobs(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.notify_job() RETURNS trigger AS $$
BEGIN PERFORM pg_notify('campusai_jobs', NEW.queue); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_jobs_notify AFTER INSERT ON app.jobs FOR EACH ROW EXECUTE FUNCTION app.notify_job();

-- ---------- AI schema ----------
CREATE TABLE ai.doc_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  subject_id uuid,
  topic_id uuid REFERENCES app.topics(id) ON DELETE SET NULL,
  chunk_index int NOT NULL,
  content text NOT NULL,
  section_path varchar(500),
  page_start int NOT NULL,
  page_end int NOT NULL,
  token_count smallint NOT NULL,
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(section_path,'') || ' ' || content)) STORED,
  embedding vector(384) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dc_emb ON ai.doc_chunks USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX ix_dc_tsv ON ai.doc_chunks USING gin (content_tsv);
CREATE INDEX ix_dc_doc ON ai.doc_chunks(user_id, document_id, chunk_index);
CREATE INDEX ix_dc_subject ON ai.doc_chunks(user_id, subject_id);

-- keep denormalized subject_id in sync
CREATE OR REPLACE FUNCTION app.sync_chunk_subject() RETURNS trigger AS $$
BEGIN
  IF NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    UPDATE ai.doc_chunks SET subject_id = NEW.subject_id WHERE document_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_doc_subject AFTER UPDATE ON app.documents FOR EACH ROW EXECUTE FUNCTION app.sync_chunk_subject();

CREATE TABLE ai.code_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES app.repositories(id) ON DELETE CASCADE,
  path varchar(1000) NOT NULL,
  language varchar(32),
  blob_sha char(40) NOT NULL,
  size_bytes int,
  line_count int,
  content text,
  is_indexed boolean NOT NULL DEFAULT true,
  UNIQUE (repository_id, path)
);
CREATE INDEX ix_cf_user ON ai.code_files(user_id, repository_id);

CREATE TABLE ai.code_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES app.repositories(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES ai.code_files(id) ON DELETE CASCADE,
  path varchar(1000) NOT NULL,
  language varchar(32),
  symbol_name varchar(300),
  symbol_kind varchar(16),
  start_line int NOT NULL,
  end_line int NOT NULL,
  content text NOT NULL,
  search_text text NOT NULL,
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  embedding vector(384) NOT NULL
);
CREATE INDEX ix_cc_emb ON ai.code_chunks USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX ix_cc_tsv ON ai.code_chunks USING gin (content_tsv);
CREATE INDEX ix_cc_repo ON ai.code_chunks(user_id, repository_id);
CREATE INDEX ix_cc_file ON ai.code_chunks(file_id);

CREATE TABLE ai.code_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES app.repositories(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES ai.code_files(id) ON DELETE CASCADE,
  name varchar(300) NOT NULL,
  qualified_name varchar(600) NOT NULL,
  kind varchar(16),
  signature varchar(1000),
  start_line int,
  end_line int
);
CREATE INDEX ix_cs_name ON ai.code_symbols(repository_id, lower(name));

CREATE TABLE ai.file_dependencies (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES app.repositories(id) ON DELETE CASCADE,
  from_file_id uuid NOT NULL REFERENCES ai.code_files(id) ON DELETE CASCADE,
  to_file_id uuid REFERENCES ai.code_files(id) ON DELETE CASCADE,
  import_text varchar(500) NOT NULL,
  is_external boolean NOT NULL
);
CREATE INDEX ix_fd_from ON ai.file_dependencies(repository_id, from_file_id);
CREATE INDEX ix_fd_to ON ai.file_dependencies(repository_id, to_file_id);

CREATE TABLE ai.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES app.conversations(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL,
  request_id varchar(64),
  route varchar(32),
  intents jsonb,
  plan jsonb,
  status varchar(16) NOT NULL DEFAULT 'RUNNING',
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  latency_ms int,
  error_code varchar(64),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX ix_runs_user ON ai.agent_runs(user_id, started_at DESC);
CREATE INDEX ix_runs_conv ON ai.agent_runs(conversation_id);

CREATE TABLE ai.agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES ai.agent_runs(id) ON DELETE CASCADE,
  step_index smallint NOT NULL,
  node varchar(64) NOT NULL,
  type varchar(16) NOT NULL,
  input_preview jsonb,
  output_preview jsonb,
  provider_model varchar(100),
  prompt_version varchar(40),
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  latency_ms int,
  status varchar(16) NOT NULL DEFAULT 'OK',
  error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_steps_run ON ai.agent_steps(run_id, step_index);
