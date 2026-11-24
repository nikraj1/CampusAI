package com.campusai.study;

import com.campusai.aiclient.AiClient;
import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.common.RateLimiter;
import com.campusai.job.JobService;
import com.campusai.security.UserPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1")
public class StudyController {
    private final Db db;
    private final AiClient ai;
    private final JobService jobs;
    private final RateLimiter limiter;

    public StudyController(Db db, AiClient ai, JobService jobs, RateLimiter limiter) {
        this.db = db; this.ai = ai; this.jobs = jobs; this.limiter = limiter;
    }

    // ---------- summaries ----------
    @PostMapping("/study/topics/{topicId}/summary")
    public Map<String, Object> topicSummary(@PathVariable UUID topicId, @RequestBody(required = false) Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> t = db.require("Topic", "select id, summary, summary_model from app.topics where id=? and user_id=?", topicId, uid);
        boolean regen = b != null && Boolean.TRUE.equals(b.get("regenerate"));
        String length = b != null && b.get("length") != null ? b.get("length").toString() : "SHORT";
        if (t.get("summary") != null && !regen && "SHORT".equals(length)) {
            return Map.of("topicId", topicId, "summary", t.get("summary"), "cached", true, "model", String.valueOf(t.get("summaryModel")));
        }
        limiter.check("gen:" + uid, 30, 86400);
        JsonNode r = ai.post("/internal/v1/study/summaries", uid, Map.of("topicId", topicId.toString(), "length", length), Duration.ofSeconds(120));
        if ("SHORT".equals(length)) {
            db.update("update app.topics set summary=?, summary_model=? where id=?", r.path("summary").asText(), r.path("model").asText(), topicId);
        }
        return Map.of("topicId", topicId, "summary", r.path("summary").asText(), "cached", false, "model", r.path("model").asText());
    }

    @PostMapping("/study/documents/{id}/summary")
    public Map<String, Object> documentSummary(@PathVariable UUID id, @RequestBody(required = false) Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        db.require("Document", "select id from app.documents where id=? and user_id=? and status='READY'", id, uid);
        limiter.check("gen:" + uid, 30, 86400);
        String length = b != null && b.get("length") != null ? b.get("length").toString() : "SHORT";
        JsonNode r = ai.post("/internal/v1/study/summaries", uid, Map.of("documentId", id.toString(), "length", length), Duration.ofSeconds(150));
        return Map.of("summary", r.path("summary").asText(), "model", r.path("model").asText());
    }

    // ---------- progress ----------
    @GetMapping("/study/progress")
    public Map<String, Object> progress(@RequestParam(required = false) UUID subjectId) {
        UUID uid = UserPrincipal.currentId();
        String join = subjectId == null ? "" : " and t.document_id in (select id from app.documents where subject_id = '" + subjectId + "')";
        if (subjectId != null) db.require("Subject", "select id from app.subjects where id=? and user_id=?", subjectId, uid);
        Double overall = db.scalar("select avg(m.mastery)::float8 from app.topic_mastery m join app.topics t on t.id=m.topic_id where m.user_id=? and m.attempts>0" + join, Double.class, uid);
        List<Map<String, Object>> weak = db.list("""
                select t.id as topic_id, t.title, m.mastery::float8 as mastery, d.title as document_title
                from app.topic_mastery m join app.topics t on t.id=m.topic_id join app.documents d on d.id=t.document_id
                where m.user_id=? and m.attempts>0""" + join + " order by m.mastery asc limit 5", uid);
        List<Map<String, Object>> recent = db.list("""
                select a.id, q.title, a.score, a.max_score, a.submitted_at from app.quiz_attempts a join app.quizzes q on q.id=a.quiz_id
                where a.user_id=? and a.submitted_at is not null order by a.submitted_at desc limit 10""", uid);
        Long taken = db.scalar("select count(*) from app.quiz_attempts where user_id=? and submitted_at is not null", Long.class, uid);
        List<LocalDate> days = db.list("select distinct (submitted_at at time zone 'UTC')::date as d from app.quiz_attempts where user_id=? and submitted_at is not null order by d desc limit 60", uid)
                .stream().map(m -> (LocalDate) m.get("d")).toList();
        int streak = 0;
        LocalDate cursor = LocalDate.now(ZoneOffset.UTC);
        if (!days.isEmpty() && days.get(0).equals(cursor.minusDays(1))) cursor = cursor.minusDays(1);
        for (LocalDate d : days) { if (d.equals(cursor)) { streak++; cursor = cursor.minusDays(1); } else if (d.isBefore(cursor)) break; }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("overallMastery", overall);
        out.put("weakTopics", weak);
        out.put("recentAttempts", recent);
        out.put("quizzesTaken", taken);
        out.put("streakDays", streak);
        return out;
    }

    @GetMapping("/study/progress/topics")
    public List<Map<String, Object>> topicProgress(@RequestParam(required = false) UUID documentId, @RequestParam(required = false) UUID subjectId) {
        UUID uid = UserPrincipal.currentId();
        StringBuilder w = new StringBuilder(" where t.user_id = ?");
        List<Object> p = new ArrayList<>(List.of(uid));
        if (documentId != null) { w.append(" and t.document_id = ?"); p.add(documentId); }
        if (subjectId != null) { w.append(" and d.subject_id = ?"); p.add(subjectId); }
        return db.list("""
                select t.id as topic_id, t.title, t.level, d.title as document_title, coalesce(m.mastery,0.5)::float8 as mastery,
                  coalesce(m.attempts,0) as attempts, m.last_practiced_at
                from app.topics t join app.documents d on d.id=t.document_id
                left join app.topic_mastery m on m.topic_id=t.id and m.user_id=t.user_id""" + w + " order by d.title, t.order_index", p.toArray());
    }

    // ---------- quizzes ----------
    @PostMapping("/quizzes")
    public ResponseEntity<Map<String, Object>> createQuiz(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        limiter.check("gen:" + uid, 30, 86400);
        List<UUID> docIds = uuids(b.get("documentIds"));
        List<UUID> topicIds = uuids(b.get("topicIds"));
        if (docIds.isEmpty() && topicIds.isEmpty()) throw ApiException.badRequest("VALIDATION_ERROR", "Select at least one document or topic");
        for (UUID d : docIds) db.require("Document", "select id from app.documents where id=? and user_id=? and status='READY'", d, uid);
        for (UUID t : topicIds) {
            Map<String, Object> row = db.require("Topic", "select document_id from app.topics where id=? and user_id=?", t, uid);
            UUID dId = (UUID) row.get("documentId");
            if (!docIds.contains(dId)) docIds.add(dId);
        }
        int n = b.get("numQuestions") == null ? 10 : Integer.parseInt(b.get("numQuestions").toString());
        if (n < 3 || n > 25) throw ApiException.badRequest("VALIDATION_ERROR", "numQuestions must be between 3 and 25");
        String diff = b.get("difficulty") == null ? "ADAPTIVE" : b.get("difficulty").toString().toUpperCase();
        if (!List.of("EASY", "MEDIUM", "HARD", "ADAPTIVE").contains(diff)) throw ApiException.badRequest("VALIDATION_ERROR", "Invalid difficulty");
        List<String> types = b.get("types") instanceof List<?> l && !l.isEmpty() ? l.stream().map(Object::toString).toList() : List.of("MCQ_SINGLE");
        String title = b.get("title") == null || b.get("title").toString().isBlank() ? "Quiz " + java.time.LocalDate.now() : b.get("title").toString().trim();
        UUID subjectId = db.one("select subject_id from app.documents where id=?", docIds.get(0)).map(m -> (UUID) m.get("subjectId")).orElse(null);

        Map<String, Object> scope = Map.of("documentIds", docIds, "topicIds", topicIds);
        UUID quizId = db.scalar("insert into app.quizzes(user_id, subject_id, title, difficulty, source_scope, status) values (?,?,?,?,?::jsonb,'GENERATING') returning id",
                UUID.class, uid, subjectId, title, diff, db.json(scope));
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("documentIds", docIds.stream().map(UUID::toString).toList());
        req.put("topicIds", topicIds.stream().map(UUID::toString).toList());
        req.put("numQuestions", n); req.put("difficulty", diff); req.put("types", types);
        UUID jobId = jobs.submit(uid, "GENERATE_QUIZ", "QUIZ", quizId, Map.of("quizId", quizId.toString()), jid -> runQuiz(uid, quizId, req),
                (jid, msg) -> db.update("update app.quizzes set status='FAILED', error_message=? where id=?", JobService.trunc(msg, 480), quizId));
        return ResponseEntity.accepted().body(Map.of("quizId", quizId, "jobId", jobId, "status", "GENERATING"));
    }

    private Map<String, Object> runQuiz(UUID uid, UUID quizId, Map<String, Object> req) {
        List<Map<String, Object>> mastery = db.list("select topic_id, mastery::float8 as mastery from app.topic_mastery where user_id=?", uid);
        List<Map<String, Object>> snap = mastery.stream().map(m -> Map.<String, Object>of("topicId", m.get("topicId").toString(), "mastery", m.get("mastery"))).toList();
        Map<String, Object> body = new LinkedHashMap<>(req);
        body.put("masterySnapshot", snap);
        JsonNode r = ai.post("/internal/v1/study/quizzes", uid, body, Duration.ofSeconds(240));
        JsonNode qs = r.path("questions");
        if (!qs.isArray() || qs.isEmpty()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "NO_QUESTIONS", "No valid questions could be generated from the selected material");
        Set<UUID> valid = db.list("select id from app.topics where user_id=?", uid).stream().map(m -> (UUID) m.get("id")).collect(Collectors.toSet());
        int i = 0;
        for (JsonNode q : qs) {
            UUID topic = null;
            if (q.hasNonNull("topicId")) { try { UUID t = UUID.fromString(q.get("topicId").asText()); if (valid.contains(t)) topic = t; } catch (Exception ignored) { } }
            List<Integer> correct = new ArrayList<>();
            q.path("correctIndices").forEach(x -> correct.add(x.asInt()));
            db.update("""
                    insert into app.quiz_questions(quiz_id, topic_id, order_index, type, stem, options, correct_indices, explanation, difficulty, bloom_level, source_refs)
                    values (?,?,?,?,?,?::jsonb,?::smallint[],?,?,?,?::jsonb)""",
                    quizId, topic, ++i, q.path("type").asText("MCQ_SINGLE"), q.path("stem").asText(), q.path("options").toString(),
                    "{" + correct.stream().map(String::valueOf).collect(Collectors.joining(",")) + "}", q.path("explanation").asText(),
                    q.path("difficulty").asText("MEDIUM").toUpperCase(), q.hasNonNull("bloomLevel") ? q.get("bloomLevel").asText() : null, q.path("sourceRefs").toString());
        }
        db.update("update app.quizzes set status='READY', question_count=? where id=?", i, quizId);
        return Map.of("quizId", quizId.toString(), "questions", i, "rejected", r.path("rejectedCount").asInt(0));
    }

    private static List<UUID> uuids(Object o) {
        List<UUID> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) out.add(UUID.fromString(x.toString()));
        return out;
    }

    @GetMapping("/quizzes")
    public Map<String, Object> listQuizzes(@RequestParam(required = false) UUID subjectId, @RequestParam(defaultValue = "0") int page) {
        UUID uid = UserPrincipal.currentId();
        String f = subjectId == null ? "" : " and q.subject_id = '" + subjectId + "'";
        var items = db.list("""
                select q.id, q.title, q.difficulty, q.question_count, q.status, q.error_message, q.created_at,
                  (select max(a.score) from app.quiz_attempts a where a.quiz_id=q.id and a.submitted_at is not null) as best_score,
                  (select max(a.max_score) from app.quiz_attempts a where a.quiz_id=q.id and a.submitted_at is not null) as best_max
                from app.quizzes q where q.user_id=?""" + f + " order by q.created_at desc limit 50 offset ?", uid, page * 50L);
        return Map.of("items", items, "page", page);
    }

    @GetMapping("/quizzes/{id}")
    public Map<String, Object> quiz(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> q = new LinkedHashMap<>(db.require("Quiz", "select id, title, difficulty, status, question_count, error_message, created_at from app.quizzes where id=? and user_id=?", id, uid));
        // NOTE: correct answers and explanations are deliberately never selected here.
        q.put("questions", db.list("""
                select qq.id, qq.type, qq.stem, qq.options, qq.order_index, t.title as topic_title
                from app.quiz_questions qq left join app.topics t on t.id=qq.topic_id where qq.quiz_id=? order by qq.order_index""", id));
        return q;
    }

    @DeleteMapping("/quizzes/{id}")
    public ResponseEntity<Void> deleteQuiz(@PathVariable UUID id) {
        db.require("Quiz", "select id from app.quizzes where id=? and user_id=?", id, UserPrincipal.currentId());
        db.update("delete from app.quizzes where id=?", id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/quizzes/{id}/attempts")
    public ResponseEntity<Map<String, Object>> startAttempt(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> q = db.require("Quiz", "select status from app.quizzes where id=? and user_id=?", id, uid);
        if (!"READY".equals(q.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "QUIZ_NOT_READY", "Quiz is not ready yet");
        Map<String, Object> a = db.require("Attempt", "insert into app.quiz_attempts(quiz_id, user_id) values (?,?) returning id, started_at", id, uid);
        return ResponseEntity.status(201).body(Map.of("attemptId", a.get("id"), "startedAt", a.get("startedAt")));
    }

    @PostMapping("/quiz-attempts/{id}/submit")
    @Transactional
    public Map<String, Object> submit(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> attempt = db.require("Attempt", "select id, quiz_id, started_at, submitted_at from app.quiz_attempts where id=? and user_id=?", id, uid);
        if (attempt.get("submittedAt") != null) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_SUBMITTED", "Attempt already submitted");
        UUID quizId = (UUID) attempt.get("quizId");
        List<Map<String, Object>> questions = db.list("select id, topic_id, correct_indices, difficulty from app.quiz_questions where quiz_id=?", quizId);
        Map<UUID, List<Integer>> selected = new HashMap<>();
        if (b.get("answers") instanceof List<?> al) {
            for (Object o : al) {
                if (!(o instanceof Map<?, ?> m)) continue;
                UUID qid = UUID.fromString(m.get("questionId").toString());
                List<Integer> sel = new ArrayList<>();
                if (m.get("selectedIndices") instanceof List<?> sl) for (Object x : sl) sel.add(Integer.parseInt(x.toString()));
                selected.put(qid, sel);
            }
        }
        int score = 0;
        Map<UUID, List<double[]>> byTopic = new HashMap<>();
        for (Map<String, Object> q : questions) {
            UUID qid = (UUID) q.get("id");
            List<Integer> correct = ((List<?>) q.get("correctIndices")).stream().map(x -> ((Number) x).intValue()).toList();
            List<Integer> sel = selected.getOrDefault(qid, List.of());
            boolean ok = MasteryCalculator.isCorrect(sel, correct);
            if (ok) score++;
            db.update("insert into app.quiz_answers(attempt_id, question_id, selected_indices, is_correct) values (?,?,?::smallint[],?)",
                    id, qid, "{" + sel.stream().map(String::valueOf).collect(Collectors.joining(",")) + "}", ok);
            if (q.get("topicId") != null) {
                byTopic.computeIfAbsent((UUID) q.get("topicId"), k -> new ArrayList<>())
                        .add(new double[]{ok ? 1 : 0, MasteryCalculator.difficultyWeight((String) q.get("difficulty"))});
            }
        }
        int duration = (int) Duration.between((java.time.Instant) attempt.get("startedAt"), java.time.Instant.now()).toSeconds();
        db.update("update app.quiz_attempts set submitted_at=now(), score=?, max_score=?, duration_seconds=? where id=?", score, questions.size(), duration, id);

        List<Map<String, Object>> changes = new ArrayList<>();
        for (var e : byTopic.entrySet()) {
            UUID topicId = e.getKey();
            double s = e.getValue().stream().mapToDouble(x -> x[0]).average().orElse(0);
            double w = e.getValue().stream().mapToDouble(x -> x[1]).average().orElse(1);
            double before = db.one("select mastery::float8 as m from app.topic_mastery where user_id=? and topic_id=?", uid, topicId)
                    .map(m -> ((Number) m.get("m")).doubleValue()).orElse(0.5);
            double after = Math.round(MasteryCalculator.update(before, s, w) * 1000.0) / 1000.0;
            int correctN = (int) e.getValue().stream().filter(x -> x[0] == 1).count();
            db.update("""
                    insert into app.topic_mastery(user_id, topic_id, mastery, attempts, correct, last_practiced_at) values (?,?,?,?,?,now())
                    on conflict (user_id, topic_id) do update set mastery=excluded.mastery, attempts=app.topic_mastery.attempts+excluded.attempts,
                      correct=app.topic_mastery.correct+excluded.correct, last_practiced_at=now()""", uid, topicId, after, e.getValue().size(), correctN);
            String title = db.scalar("select title from app.topics where id=?", String.class, topicId);
            changes.add(Map.of("topicId", topicId, "title", title, "before", before, "after", after));
        }
        Map<String, Object> out = new LinkedHashMap<>(attemptResult(id, uid));
        out.put("masteryChanges", changes);
        return out;
    }

    @GetMapping("/quiz-attempts/{id}")
    public Map<String, Object> attempt(@PathVariable UUID id) {
        return attemptResult(id, UserPrincipal.currentId());
    }

    private Map<String, Object> attemptResult(UUID id, UUID uid) {
        Map<String, Object> a = db.require("Attempt", "select id, quiz_id, score, max_score, duration_seconds, submitted_at from app.quiz_attempts where id=? and user_id=?", id, uid);
        if (a.get("submittedAt") == null) throw new ApiException(HttpStatus.CONFLICT, "NOT_SUBMITTED", "Attempt not submitted yet");
        List<Map<String, Object>> rows = db.list("""
                select q.id as question_id, q.stem, q.options, q.explanation, q.correct_indices, q.source_refs, an.selected_indices, an.is_correct
                from app.quiz_questions q join app.quiz_answers an on an.question_id=q.id and an.attempt_id=? order by q.order_index""", id);
        List<Map<String, Object>> results = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("questionId", r.get("questionId")); m.put("stem", r.get("stem")); m.put("options", r.get("options"));
            m.put("correct", r.get("isCorrect")); m.put("selectedIndices", r.get("selectedIndices"));
            m.put("correctIndices", r.get("correctIndices")); m.put("explanation", r.get("explanation"));
            List<Map<String, Object>> sources = new ArrayList<>();
            if (r.get("sourceRefs") instanceof JsonNode refs && refs.isArray()) {
                for (JsonNode ref : refs) {
                    String did = ref.path("documentId").asText(null);
                    if (did == null) continue;
                    String title = db.one("select title from app.documents where id = ?::uuid and user_id = ?", did, uid).map(x -> (String) x.get("title")).orElse(null);
                    Map<String, Object> s = new LinkedHashMap<>();
                    s.put("documentId", did); s.put("title", title == null ? "(source deleted)" : title);
                    s.put("pageStart", ref.path("pageStart").asInt(0)); s.put("pageEnd", ref.path("pageEnd").asInt(0));
                    sources.add(s);
                }
            }
            m.put("sources", sources);
            results.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("attemptId", id); out.put("quizId", a.get("quizId")); out.put("score", a.get("score")); out.put("maxScore", a.get("maxScore"));
        out.put("durationSeconds", a.get("durationSeconds")); out.put("results", results);
        return out;
    }
}
