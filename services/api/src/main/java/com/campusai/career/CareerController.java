package com.campusai.career;

import com.campusai.aiclient.AiClient;
import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.common.RateLimiter;
import com.campusai.job.JobService;
import com.campusai.security.UserPrincipal;
import com.campusai.storage.FileStorage;
import com.campusai.study.DocumentService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Duration;
import java.util.*;

@RestController
@RequestMapping("/api/v1/career")
public class CareerController {
    private final Db db;
    private final AiClient ai;
    private final JobService jobs;
    private final DocumentService docs;
    private final FileStorage storage;
    private final RateLimiter limiter;

    public CareerController(Db db, AiClient ai, JobService jobs, DocumentService docs, FileStorage storage, RateLimiter limiter) {
        this.db = db; this.ai = ai; this.jobs = jobs; this.docs = docs; this.storage = storage; this.limiter = limiter;
    }

    // ---------- resumes ----------
    @PostMapping(value = "/resumes", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> uploadResume(@RequestPart("file") MultipartFile file, @RequestParam(required = false) String label) {
        UUID uid = UserPrincipal.currentId();
        UUID[] resumeId = new UUID[1];
        var up = docs.upload(uid, file, "RESUME", label, null, docId -> {
            boolean first = db.scalar("select count(*) from app.resumes where user_id=?", Long.class, uid) == 0;
            String lbl = label == null || label.isBlank() ? file.getOriginalFilename() : label.trim();
            resumeId[0] = db.scalar("insert into app.resumes(user_id, document_id, label, is_primary) values (?,?,?,?) returning id", UUID.class, uid, docId, lbl, first);
        });
        return ResponseEntity.accepted().body(Map.of("resumeId", resumeId[0], "documentId", up.documentId(), "jobId", up.jobId()));
    }

    @GetMapping("/resumes")
    public List<Map<String, Object>> resumes() {
        return db.list("select id, label, is_primary, parse_status, created_at from app.resumes where user_id=? order by created_at desc", UserPrincipal.currentId());
    }

    @GetMapping("/resumes/{id}")
    public Map<String, Object> resume(@PathVariable UUID id) {
        Map<String, Object> r = new LinkedHashMap<>(db.require("Resume", "select id, document_id, label, is_primary, parse_status, parsed, created_at from app.resumes where id=? and user_id=?", id, UserPrincipal.currentId()));
        r.put("latestJob", db.one("select id, status, stage, progress, error_message from app.jobs where resource_type='DOCUMENT' and resource_id=? order by created_at desc limit 1", r.get("documentId")).orElse(null));
        return r;
    }

    @PatchMapping("/resumes/{id}")
    public Map<String, Object> patchResume(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        db.require("Resume", "select id from app.resumes where id=? and user_id=?", id, uid);
        if (b.get("label") != null) db.update("update app.resumes set label=? where id=?", b.get("label").toString(), id);
        if (Boolean.TRUE.equals(b.get("isPrimary"))) {
            db.update("update app.resumes set is_primary=false where user_id=? and is_primary", uid);
            db.update("update app.resumes set is_primary=true where id=?", id);
        }
        if (b.get("parsedSkills") instanceof List<?> skills) {
            db.update("update app.resumes set parsed = jsonb_set(coalesce(parsed,'{}'::jsonb), '{skills}', ?::jsonb) where id=?", db.json(skills), id);
            db.update("delete from app.user_skills where user_id=? and source='RESUME'", uid);
            for (Object s : skills) {
                String name = s instanceof Map<?, ?> m ? String.valueOf(m.get("name")) : String.valueOf(s);
                if (!name.isBlank() && !"null".equals(name)) db.update("insert into app.user_skills(user_id, skill, source) values (?,?,'RESUME') on conflict (user_id, skill) do nothing", uid, name.trim());
            }
        }
        return resume(id);
    }

    @DeleteMapping("/resumes/{id}")
    public ResponseEntity<Void> deleteResume(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> r = db.require("Resume", "select r.document_id, d.storage_key from app.resumes r join app.documents d on d.id=r.document_id where r.id=? and r.user_id=?", id, uid);
        db.update("delete from app.documents where id=?", r.get("documentId")); // cascades resume + analyses
        storage.delete((String) r.get("storageKey"));
        return ResponseEntity.noContent().build();
    }

    // ---------- job descriptions ----------
    @PostMapping("/job-descriptions")
    public ResponseEntity<Map<String, Object>> createJd(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        String raw = b.get("rawText") == null ? "" : b.get("rawText").toString().trim();
        if (raw.length() < 40) throw ApiException.badRequest("VALIDATION_ERROR", "Job description text is too short");
        if (raw.length() > 20000) throw ApiException.badRequest("VALIDATION_ERROR", "Job description exceeds 20,000 characters");
        limiter.check("gen:" + uid, 30, 86400);
        JsonNode r = ai.post("/internal/v1/career/jd/parse", uid, Map.of("rawText", raw), Duration.ofSeconds(60));
        JsonNode parsed = r.path("parsed");
        String title = b.get("title") != null && !b.get("title").toString().isBlank() ? b.get("title").toString() : parsed.path("title").asText(null);
        String company = b.get("company") != null && !b.get("company").toString().isBlank() ? b.get("company").toString() : parsed.path("company").asText(null);
        UUID id = db.scalar("insert into app.job_descriptions(user_id, title, company, raw_text, parsed, source_url) values (?,?,?,?,?::jsonb,?) returning id",
                UUID.class, uid, title, company, raw, parsed.toString(), b.get("sourceUrl"));
        return ResponseEntity.status(201).body(db.require("JD", "select id, title, company, parsed, created_at from app.job_descriptions where id=?", id));
    }

    @GetMapping("/job-descriptions")
    public List<Map<String, Object>> jds() {
        return db.list("select id, title, company, created_at from app.job_descriptions where user_id=? order by created_at desc", UserPrincipal.currentId());
    }

    @GetMapping("/job-descriptions/{id}")
    public Map<String, Object> jd(@PathVariable UUID id) {
        return db.require("JD", "select id, title, company, raw_text, parsed, source_url, created_at from app.job_descriptions where id=? and user_id=?", id, UserPrincipal.currentId());
    }

    @DeleteMapping("/job-descriptions/{id}")
    public ResponseEntity<Void> deleteJd(@PathVariable UUID id) {
        db.require("JD", "select id from app.job_descriptions where id=? and user_id=?", id, UserPrincipal.currentId());
        db.update("delete from app.job_descriptions where id=?", id);
        return ResponseEntity.noContent().build();
    }

    // ---------- analyses ----------
    @PostMapping("/analyses")
    public ResponseEntity<Map<String, Object>> analyze(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        limiter.check("gen:" + uid, 30, 86400);
        UUID resumeId = UUID.fromString(String.valueOf(b.get("resumeId")));
        Map<String, Object> resume = db.require("Resume", "select parse_status from app.resumes where id=? and user_id=?", resumeId, uid);
        if (!"PARSED".equals(resume.get("parseStatus"))) throw new ApiException(HttpStatus.CONFLICT, "RESUME_NOT_PARSED", "Resume has not finished parsing yet");
        UUID jdId = null;
        if (b.get("jobDescriptionId") != null && !b.get("jobDescriptionId").toString().isBlank()) {
            jdId = UUID.fromString(b.get("jobDescriptionId").toString());
            db.require("JD", "select id from app.job_descriptions where id=? and user_id=?", jdId, uid);
        }
        final UUID jd = jdId;
        Map<String, Object> req = new HashMap<>();
        req.put("resumeId", resumeId.toString());
        if (jd != null) req.put("jobDescriptionId", jd.toString());
        UUID jobId = jobs.submit(uid, "ANALYZE_RESUME", "RESUME", resumeId, Map.of("resumeId", resumeId.toString()), jid -> {
            JsonNode r = ai.post("/internal/v1/career/analyses", uid, req, Duration.ofSeconds(180));
            UUID aid = db.scalar("""
                    insert into app.resume_analyses(user_id, resume_id, job_description_id, type, overall_score, match_score, result, model_used, prompt_version)
                    values (?,?,?,?,?,?,?::jsonb,?,?) returning id""", UUID.class, uid, resumeId, jd, r.path("type").asText(jd == null ? "GENERAL" : "JD_MATCH"),
                    r.path("overallScore").asInt(), r.hasNonNull("matchScore") ? r.get("matchScore").asInt() : null, r.path("result").toString(),
                    r.path("model").asText(null), r.path("promptVersion").asText(null));
            return Map.of("analysisId", aid.toString());
        }, null);
        return ResponseEntity.accepted().body(Map.of("jobId", jobId));
    }

    @GetMapping("/analyses")
    public List<Map<String, Object>> analyses(@RequestParam(required = false) UUID resumeId) {
        UUID uid = UserPrincipal.currentId();
        String f = resumeId == null ? "" : " and a.resume_id = '" + resumeId + "'";
        return db.list("""
                select a.id, a.resume_id, a.type, a.overall_score, a.match_score, j.title as job_title, j.company, a.created_at
                from app.resume_analyses a left join app.job_descriptions j on j.id=a.job_description_id
                where a.user_id=?""" + f + " order by a.created_at desc limit 50", uid);
    }

    @GetMapping("/analyses/{id}")
    public Map<String, Object> analysis(@PathVariable UUID id) {
        return db.require("Analysis", """
                select a.id, a.resume_id, a.job_description_id, a.type, a.overall_score, a.match_score, a.result, a.model_used, a.created_at,
                  j.title as job_title, j.company
                from app.resume_analyses a left join app.job_descriptions j on j.id=a.job_description_id where a.id=? and a.user_id=?""", id, UserPrincipal.currentId());
    }

    // ---------- skills ----------
    @GetMapping("/skills/me")
    public List<Map<String, Object>> mySkills() {
        return db.list("select skill, category, proficiency, source from app.user_skills where user_id=? order by skill", UserPrincipal.currentId());
    }

    @PutMapping("/skills/me")
    public List<Map<String, Object>> putSkills(@RequestBody List<Map<String, Object>> skills) {
        UUID uid = UserPrincipal.currentId();
        db.update("delete from app.user_skills where user_id=? and source='SELF'", uid);
        for (Map<String, Object> s : skills) {
            String name = String.valueOf(s.get("skill")).trim();
            if (name.isEmpty() || name.length() > 100) continue;
            Integer prof = s.get("proficiency") == null ? null : Integer.valueOf(s.get("proficiency").toString());
            db.update("insert into app.user_skills(user_id, skill, proficiency, source) values (?,?,?,'SELF') on conflict (user_id, skill) do update set proficiency=excluded.proficiency, updated_at=now()", uid, name, prof);
        }
        return mySkills();
    }

    // ---------- roadmaps ----------
    @PostMapping("/roadmaps")
    public ResponseEntity<Map<String, Object>> createRoadmap(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        limiter.check("gen:" + uid, 30, 86400);
        String role = b.get("targetRole") == null ? "" : b.get("targetRole").toString().trim();
        if (role.isEmpty()) throw ApiException.badRequest("VALIDATION_ERROR", "targetRole is required");
        int weeks = b.get("durationWeeks") == null ? 8 : Integer.parseInt(b.get("durationWeeks").toString());
        int hours = b.get("hoursPerWeek") == null ? 10 : Integer.parseInt(b.get("hoursPerWeek").toString());
        if (weeks < 1 || weeks > 24 || hours < 1 || hours > 60) throw ApiException.badRequest("VALIDATION_ERROR", "durationWeeks 1-24, hoursPerWeek 1-60");
        UUID analysisId = null;
        if (b.get("analysisId") != null && !b.get("analysisId").toString().isBlank()) {
            analysisId = UUID.fromString(b.get("analysisId").toString());
            db.require("Analysis", "select id from app.resume_analyses where id=? and user_id=?", analysisId, uid);
        }
        final UUID aid = analysisId;
        Map<String, Object> req = new HashMap<>(Map.of("targetRole", role, "durationWeeks", weeks, "hoursPerWeek", hours));
        if (aid != null) req.put("analysisId", aid.toString());
        UUID jobId = jobs.submit(uid, "GENERATE_ROADMAP", "ROADMAP", null, Map.of("targetRole", role), jid -> {
            JsonNode r = ai.post("/internal/v1/career/roadmaps", uid, req, Duration.ofSeconds(180));
            JsonNode items = r.path("items");
            if (!items.isArray() || items.isEmpty()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "EMPTY_ROADMAP", "Could not generate a roadmap");
            UUID rid = db.scalar("insert into app.career_roadmaps(user_id, analysis_id, target_role, duration_weeks, hours_per_week) values (?,?,?,?,?) returning id", UUID.class, uid, aid, role, weeks, hours);
            for (JsonNode it : items) {
                List<String> linked = new ArrayList<>();
                it.path("linkedTopicIds").forEach(x -> linked.add(x.asText()));
                db.update("""
                        insert into app.roadmap_items(roadmap_id, week_no, order_index, title, description, skill, resources, linked_topic_ids)
                        values (?,?,?,?,?,?,?::jsonb,?::uuid[])""", rid, it.path("weekNo").asInt(1), it.path("orderIndex").asInt(0), it.path("title").asText(),
                        it.path("description").asText(null), it.hasNonNull("skill") ? it.get("skill").asText() : null, it.path("resources").toString(),
                        "{" + String.join(",", linked) + "}");
            }
            return Map.of("roadmapId", rid.toString());
        }, null);
        return ResponseEntity.accepted().body(Map.of("jobId", jobId));
    }

    @GetMapping("/roadmaps")
    public List<Map<String, Object>> roadmaps() {
        return db.list("""
                select r.id, r.target_role, r.status, r.duration_weeks, r.created_at,
                  coalesce(round(100.0 * count(i.*) filter (where i.status='DONE') / nullif(count(i.*),0)),0)::int as progress_pct
                from app.career_roadmaps r left join app.roadmap_items i on i.roadmap_id=r.id where r.user_id=? group by r.id order by r.created_at desc""", UserPrincipal.currentId());
    }

    @GetMapping("/roadmaps/{id}")
    public Map<String, Object> roadmap(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> r = new LinkedHashMap<>(db.require("Roadmap", "select id, target_role, status, duration_weeks, hours_per_week, created_at from app.career_roadmaps where id=? and user_id=?", id, uid));
        List<Map<String, Object>> items = db.list("""
                select i.id, i.week_no, i.order_index, i.title, i.description, i.skill, i.resources, i.status, i.completed_at,
                  coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'documentId', t.document_id)) from app.topics t where t.id = any(i.linked_topic_ids) and t.user_id = ?), '[]'::jsonb) as linked_topics
                from app.roadmap_items i where i.roadmap_id=? order by i.week_no, i.order_index""", uid, id);
        Map<Integer, List<Map<String, Object>>> byWeek = new TreeMap<>();
        for (var it : items) byWeek.computeIfAbsent(((Number) it.get("weekNo")).intValue(), k -> new ArrayList<>()).add(it);
        List<Map<String, Object>> weeks = new ArrayList<>();
        byWeek.forEach((k, v) -> weeks.add(Map.of("weekNo", k, "items", v)));
        long done = items.stream().filter(i -> "DONE".equals(i.get("status"))).count();
        r.put("weeks", weeks);
        r.put("progressPct", items.isEmpty() ? 0 : Math.round(100.0 * done / items.size()));
        return r;
    }

    @PatchMapping("/roadmaps/{id}/items/{itemId}")
    public Map<String, Object> patchItem(@PathVariable UUID id, @PathVariable UUID itemId, @RequestBody Map<String, Object> b) {
        db.require("Roadmap", "select id from app.career_roadmaps where id=? and user_id=?", id, UserPrincipal.currentId());
        String st = String.valueOf(b.get("status"));
        if (!List.of("TODO", "IN_PROGRESS", "DONE").contains(st)) throw ApiException.badRequest("VALIDATION_ERROR", "Invalid status");
        int n = db.update("update app.roadmap_items set status=?, completed_at = case when ?='DONE' then now() else null end where id=? and roadmap_id=?", st, st, itemId, id);
        if (n == 0) throw ApiException.notFound("Roadmap item");
        return db.require("Item", "select id, status, completed_at from app.roadmap_items where id=?", itemId);
    }

    @PatchMapping("/roadmaps/{id}")
    public Map<String, Object> patchRoadmap(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        db.require("Roadmap", "select id from app.career_roadmaps where id=? and user_id=?", id, UserPrincipal.currentId());
        String st = String.valueOf(b.get("status"));
        if (!List.of("ACTIVE", "COMPLETED", "ARCHIVED").contains(st)) throw ApiException.badRequest("VALIDATION_ERROR", "Invalid status");
        db.update("update app.career_roadmaps set status=? where id=?", st, id);
        return roadmap(id);
    }

    @DeleteMapping("/roadmaps/{id}")
    public ResponseEntity<Void> deleteRoadmap(@PathVariable UUID id) {
        db.require("Roadmap", "select id from app.career_roadmaps where id=? and user_id=?", id, UserPrincipal.currentId());
        db.update("delete from app.career_roadmaps where id=?", id);
        return ResponseEntity.noContent().build();
    }
}
