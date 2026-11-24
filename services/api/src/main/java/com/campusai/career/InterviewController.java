package com.campusai.career;

import com.campusai.aiclient.AiClient;
import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.common.RateLimiter;
import com.campusai.security.UserPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.*;

@RestController
@RequestMapping("/api/v1/career")
public class InterviewController {
    private final Db db;
    private final AiClient ai;
    private final RateLimiter limiter;

    public InterviewController(Db db, AiClient ai, RateLimiter limiter) { this.db = db; this.ai = ai; this.limiter = limiter; }

    @PostMapping("/interview-questions")
    public JsonNode questionBank(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        limiter.check("gen:" + uid, 30, 86400);
        if (b.get("jobDescriptionId") != null && !b.get("jobDescriptionId").toString().isBlank()) {
            db.require("JD", "select id from app.job_descriptions where id=? and user_id=?", UUID.fromString(b.get("jobDescriptionId").toString()), uid);
        }
        JsonNode r = ai.post("/internal/v1/career/interview-questions", uid, b, Duration.ofSeconds(120));
        return r.path("questions");
    }

    @PostMapping("/interviews")
    public ResponseEntity<Map<String, Object>> start(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        limiter.check("gen:" + uid, 30, 86400);
        String type = String.valueOf(b.getOrDefault("type", "TECHNICAL")).toUpperCase();
        if (!List.of("TECHNICAL", "HR", "MIXED").contains(type)) throw ApiException.badRequest("VALIDATION_ERROR", "Invalid type");
        int n = b.get("numQuestions") == null ? 5 : Integer.parseInt(b.get("numQuestions").toString());
        if (n < 1 || n > 10) throw ApiException.badRequest("VALIDATION_ERROR", "numQuestions must be 1-10");
        UUID jd = optId(b.get("jobDescriptionId"), "app.job_descriptions", "JD", uid);
        UUID resume = optId(b.get("resumeId"), "app.resumes", "Resume", uid);
        String role = b.get("targetRole") == null ? null : b.get("targetRole").toString();
        String diff = String.valueOf(b.getOrDefault("difficulty", "MEDIUM")).toUpperCase();
        UUID sid = db.scalar("insert into app.interview_sessions(user_id, type, target_role, job_description_id, resume_id, difficulty, planned_questions) values (?,?,?,?,?,?,?) returning id",
                UUID.class, uid, type, role, jd, resume, diff, n);
        try {
            JsonNode plan = ai.post("/internal/v1/career/interviews/plan", uid, Map.of("sessionId", sid.toString()), Duration.ofSeconds(90));
            JsonNode qs = plan.path("questions");
            if (!qs.isArray() || qs.isEmpty()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "NO_QUESTIONS", "Could not plan interview questions");
            int i = 0;
            for (JsonNode q : qs) {
                db.update("insert into app.interview_questions(session_id, order_index, category, question) values (?,?,?,?)", sid, (++i) * 10, q.path("category").asText(null), q.path("question").asText());
            }
        } catch (RuntimeException e) {
            db.update("delete from app.interview_sessions where id=?", sid);
            throw e;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sessionId", sid);
        out.put("question", nextQuestion(sid));
        return ResponseEntity.status(201).body(out);
    }

    private UUID optId(Object v, String table, String what, UUID uid) {
        if (v == null || v.toString().isBlank()) return null;
        UUID id = UUID.fromString(v.toString());
        db.require(what, "select id from " + table + " where id=? and user_id=?", id, uid);
        return id;
    }

    private Map<String, Object> nextQuestion(UUID sid) {
        return db.one("select id, order_index, question as text, category, (parent_id is not null) as is_follow_up from app.interview_questions where session_id=? and answer is null order by order_index limit 1", sid).orElse(null);
    }

    @PostMapping("/interviews/{id}/answers")
    public Map<String, Object> answer(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> s = db.require("Interview", "select id, status from app.interview_sessions where id=? and user_id=?", id, uid);
        if (!"IN_PROGRESS".equals(s.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "INTERVIEW_ENDED", "This interview has ended");
        limiter.check("msg-min:" + uid, 15, 60);
        UUID qid = UUID.fromString(String.valueOf(b.get("questionId")));
        String answer = b.get("answer") == null ? "" : b.get("answer").toString().trim();
        if (answer.isEmpty() || answer.length() > 6000) throw ApiException.badRequest("VALIDATION_ERROR", "Answer must be 1-6000 characters");
        Map<String, Object> q = db.require("Question", "select id, order_index, category, parent_id from app.interview_questions where id=? and session_id=? and (answer is null or scores is null)", qid, id);
        db.update("update app.interview_questions set answer=?, answered_at=now() where id=?", answer, qid);
        JsonNode ev = ai.post("/internal/v1/career/interviews/evaluate", uid, Map.of("sessionId", id.toString(), "questionId", qid.toString()), Duration.ofSeconds(120));
        db.update("update app.interview_questions set scores=?::jsonb, feedback=? where id=?", ev.path("scores").toString(), ev.path("feedback").asText(null), qid);
        JsonNode fu = ev.path("followUp");
        if (fu.isObject() && fu.hasNonNull("question") && q.get("parentId") == null) {
            db.update("insert into app.interview_questions(session_id, order_index, parent_id, category, question) values (?,?,?,?,?)",
                    id, ((Number) q.get("orderIndex")).intValue() + 1, qid, q.get("category"), fu.get("question").asText());
        }
        Map<String, Object> next = nextQuestion(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("evaluation", Map.of("scores", ev.path("scores"), "feedback", ev.path("feedback").asText("")));
        out.put("next", next);
        out.put("completed", next == null);
        if (next == null) out.put("report", finish(id, uid));
        return out;
    }

    private Map<String, Object> finish(UUID id, UUID uid) {
        JsonNode r = ai.post("/internal/v1/career/interviews/report", uid, Map.of("sessionId", id.toString()), Duration.ofSeconds(120));
        db.update("update app.interview_sessions set status='COMPLETED', overall_score=?, report=?::jsonb, ended_at=now() where id=?", r.path("overallScore").asInt(), r.path("report").toString(), id);
        return Map.of("overallScore", r.path("overallScore").asInt(), "report", r.path("report"));
    }

    @PostMapping("/interviews/{id}/end")
    public Map<String, Object> end(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> s = db.require("Interview", "select status from app.interview_sessions where id=? and user_id=?", id, uid);
        if ("COMPLETED".equals(s.get("status"))) return detail(id);
        long answered = db.scalar("select count(*) from app.interview_questions where session_id=? and scores is not null", Long.class, id);
        if (answered == 0) {
            db.update("update app.interview_sessions set status='ABANDONED', ended_at=now() where id=?", id);
            return detail(id);
        }
        finish(id, uid);
        return detail(id);
    }

    @GetMapping("/interviews")
    public List<Map<String, Object>> list() {
        return db.list("select id, type, target_role, status, overall_score, planned_questions, started_at from app.interview_sessions where user_id=? order by started_at desc limit 50", UserPrincipal.currentId());
    }

    @GetMapping("/interviews/{id}")
    public Map<String, Object> detail(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> s = new LinkedHashMap<>(db.require("Interview", "select id, type, target_role, difficulty, planned_questions, status, overall_score, report, started_at, ended_at from app.interview_sessions where id=? and user_id=?", id, uid));
        s.put("questions", db.list("select id, order_index, parent_id, category, question, answer, scores, feedback from app.interview_questions where session_id=? order by order_index", id));
        s.put("next", "IN_PROGRESS".equals(s.get("status")) ? nextQuestion(id) : null);
        return s;
    }
}
