package com.campusai.project;

import com.campusai.aiclient.AiClient;
import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.common.RateLimiter;
import com.campusai.job.JobService;
import com.campusai.security.UserPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/v1/projects/repositories")
public class ProjectController {
    private static final Pattern URL = Pattern.compile("^(?:https?://)?(?:www\\.)?github\\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\\.git)?(?:/tree/([A-Za-z0-9_./-]+))?/?$");
    private static final Pattern FULL = Pattern.compile("^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$");

    private final Db db;
    private final AiClient ai;
    private final JobService jobs;
    private final RateLimiter limiter;

    public ProjectController(Db db, AiClient ai, JobService jobs, RateLimiter limiter) { this.db = db; this.ai = ai; this.jobs = jobs; this.limiter = limiter; }

    /** Parses a GitHub URL or "owner/name". Package-private for unit testing. */
    static String[] parseRepo(String url, String fullName) {
        String owner, name, branch = null;
        if (url != null && !url.isBlank()) {
            Matcher m = URL.matcher(url.trim());
            if (!m.matches()) throw ApiException.badRequest("INVALID_REPO_URL", "Enter a GitHub repository URL like https://github.com/owner/repo");
            owner = m.group(1); name = m.group(2); branch = m.group(3);
        } else if (fullName != null && !fullName.isBlank()) {
            Matcher m = FULL.matcher(fullName.trim());
            if (!m.matches()) throw ApiException.badRequest("INVALID_REPO_URL", "fullName must look like owner/repo");
            owner = m.group(1); name = m.group(2);
        } else throw ApiException.badRequest("VALIDATION_ERROR", "url or fullName is required");
        return new String[]{owner, name, branch};
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> add(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        limiter.check("repo:" + uid, 5, 86400);
        String[] p = parseRepo((String) b.get("url"), (String) b.get("fullName"));
        String branch = b.get("branch") != null && !b.get("branch").toString().isBlank() ? b.get("branch").toString().trim() : p[2];
        String full = p[0] + "/" + p[1];
        if (branch != null && !branch.matches("[A-Za-z0-9_./-]{1,100}")) throw ApiException.badRequest("INVALID_BRANCH", "Invalid branch name");
        UUID id;
        try {
            id = db.scalar("insert into app.repositories(user_id, full_name, html_url, branch, index_status) values (?,?,?,?,'QUEUED') returning id", UUID.class,
                    uid, full, "https://github.com/" + full, branch == null ? "" : branch);
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "REPO_EXISTS", "This repository is already added");
        }
        UUID jobId = jobs.create(uid, "AI_INGEST", "INDEX_REPOSITORY", "REPOSITORY", id, Map.of("repositoryId", id.toString()));
        return ResponseEntity.accepted().body(Map.of("repositoryId", id, "jobId", jobId));
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return db.list("select id, full_name, html_url, branch, index_status, error_message, file_count, chunk_count, languages, indexed_at, created_at from app.repositories where user_id=? order by created_at desc", UserPrincipal.currentId());
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable UUID id) {
        Map<String, Object> r = new LinkedHashMap<>(db.require("Repository", """
                select id, full_name, html_url, branch, index_status, error_message, file_count, chunk_count, languages, detected_stack, summary,
                  last_indexed_commit, indexed_at, created_at from app.repositories where id=? and user_id=?""", id, UserPrincipal.currentId()));
        r.put("latestJob", db.one("select id, status, stage, progress, error_message from app.jobs where resource_type='REPOSITORY' and resource_id=? order by created_at desc limit 1", id).orElse(null));
        return r;
    }

    @GetMapping("/{id}/tree")
    public List<Map<String, Object>> tree(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        db.require("Repository", "select id from app.repositories where id=? and user_id=?", id, uid);
        return db.list("select path, language, size_bytes, line_count, is_indexed from ai.code_files where repository_id=? and user_id=? order by path", id, uid);
    }

    @GetMapping("/{id}/file")
    public Map<String, Object> file(@PathVariable UUID id, @RequestParam String path, @RequestParam(required = false) Integer start, @RequestParam(required = false) Integer end) {
        UUID uid = UserPrincipal.currentId();
        db.require("Repository", "select id from app.repositories where id=? and user_id=?", id, uid);
        Map<String, Object> f = db.require("File", "select path, language, content, line_count from ai.code_files where repository_id=? and user_id=? and path=?", id, uid, path);
        String content = (String) f.get("content");
        if (content == null) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "NOT_AVAILABLE", "File content is not available (binary or too large)");
        String[] lines = content.split("\n", -1);
        int s = Math.max(1, start == null ? 1 : start);
        int e = Math.min(lines.length, end == null ? lines.length : end);
        if (start != null || end != null) content = String.join("\n", Arrays.copyOfRange(lines, s - 1, Math.max(s - 1, e)));
        return Map.of("path", f.get("path"), "language", String.valueOf(f.get("language")), "content", content, "startLine", s, "endLine", e, "totalLines", lines.length);
    }

    @PostMapping("/{id}/reindex")
    public ResponseEntity<Map<String, Object>> reindex(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> r = db.require("Repository", "select index_status from app.repositories where id=? and user_id=?", id, uid);
        if ("INDEXING".equals(r.get("indexStatus")) || "QUEUED".equals(r.get("indexStatus"))) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_INDEXING", "Repository is already being indexed");
        db.update("update app.repositories set index_status='QUEUED', error_message=null, updated_at=now() where id=?", id);
        UUID jobId = jobs.create(uid, "AI_INGEST", "INDEX_REPOSITORY", "REPOSITORY", id, Map.of("repositoryId", id.toString()));
        return ResponseEntity.accepted().body(Map.of("jobId", jobId));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        db.require("Repository", "select id from app.repositories where id=? and user_id=?", id, UserPrincipal.currentId());
        db.update("update app.jobs set status='CANCELLED', updated_at=now() where resource_type='REPOSITORY' and resource_id=? and status='QUEUED'", id);
        db.update("delete from app.repositories where id=?", id); // cascades every ai.code_* row
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/docs")
    public ResponseEntity<Map<String, Object>> docs(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        limiter.check("gen:" + uid, 30, 86400);
        Map<String, Object> r = db.require("Repository", "select index_status from app.repositories where id=? and user_id=?", id, uid);
        if (!"READY".equals(r.get("indexStatus"))) throw new ApiException(HttpStatus.CONFLICT, "NOT_READY", "Repository is not indexed yet");
        String type = String.valueOf(b.getOrDefault("type", "README")).toUpperCase();
        if (!List.of("README", "API", "ARCHITECTURE").contains(type)) throw ApiException.badRequest("VALIDATION_ERROR", "type must be README, API or ARCHITECTURE");
        UUID jobId = jobs.submit(uid, "GENERATE_DOCS", "REPOSITORY", id, Map.of("type", type), jid -> {
            JsonNode res = ai.post("/internal/v1/projects/docs", uid, Map.of("repositoryId", id.toString(), "type", type), Duration.ofSeconds(240));
            return Map.of("markdown", res.path("markdown").asText(), "type", type);
        }, null);
        return ResponseEntity.accepted().body(Map.of("jobId", jobId));
    }
}
