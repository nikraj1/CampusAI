package com.campusai.study;

import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.job.JobService;
import com.campusai.security.UserPrincipal;
import com.campusai.storage.FileStorage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class DocumentController {
    public record SubjectReq(@NotBlank @Size(max = 120) String name, String description, String color) {}

    private final Db db;
    private final DocumentService docs;
    private final FileStorage storage;
    private final JobService jobs;

    public DocumentController(Db db, DocumentService docs, FileStorage storage, JobService jobs) {
        this.db = db; this.docs = docs; this.storage = storage; this.jobs = jobs;
    }

    // ---------- subjects ----------
    @GetMapping("/subjects")
    public List<Map<String, Object>> subjects() {
        return db.list("""
                select s.id, s.name, s.description, s.color, s.created_at,
                  (select count(*) from app.documents d where d.subject_id = s.id) as document_count
                from app.subjects s where s.user_id = ? order by s.name""", UserPrincipal.currentId());
    }

    @PostMapping("/subjects")
    public ResponseEntity<Map<String, Object>> createSubject(@Valid @RequestBody SubjectReq r) {
        UUID uid = UserPrincipal.currentId();
        if (db.scalar("select count(*) from app.subjects where user_id=? and name=?", Long.class, uid, r.name().trim()) > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "SUBJECT_EXISTS", "A subject with this name already exists");
        }
        UUID id = db.scalar("insert into app.subjects(user_id, name, description, color) values (?,?,?,?) returning id", UUID.class,
                uid, r.name().trim(), r.description(), r.color());
        return ResponseEntity.status(201).body(db.require("Subject", "select id, name, description, color, created_at from app.subjects where id = ?", id));
    }

    @PatchMapping("/subjects/{id}")
    public Map<String, Object> updateSubject(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        db.require("Subject", "select id from app.subjects where id=? and user_id=?", id, uid);
        if (b.get("name") != null) db.update("update app.subjects set name=? where id=?", b.get("name").toString().trim(), id);
        if (b.containsKey("description")) db.update("update app.subjects set description=? where id=?", b.get("description"), id);
        if (b.containsKey("color")) db.update("update app.subjects set color=? where id=?", b.get("color"), id);
        return db.require("Subject", "select id, name, description, color, created_at from app.subjects where id=?", id);
    }

    @DeleteMapping("/subjects/{id}")
    public ResponseEntity<Void> deleteSubject(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        db.require("Subject", "select id from app.subjects where id=? and user_id=?", id, uid);
        db.update("delete from app.subjects where id=?", id);
        return ResponseEntity.noContent().build();
    }

    // ---------- documents ----------
    @PostMapping(value = "/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> upload(@RequestPart("file") MultipartFile file,
                                                      @RequestParam(required = false) String title,
                                                      @RequestParam(required = false) UUID subjectId) {
        var up = docs.upload(UserPrincipal.currentId(), file, "STUDY", title, subjectId);
        return ResponseEntity.accepted().body(Map.of("documentId", up.documentId(), "jobId", up.jobId(), "status", "UPLOADED"));
    }

    @GetMapping("/documents")
    public Map<String, Object> list(@RequestParam(required = false) UUID subjectId, @RequestParam(required = false) String status,
                                    @RequestParam(required = false) String q, @RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "50") int size) {
        UUID uid = UserPrincipal.currentId();
        size = Math.min(Math.max(size, 1), 100);
        StringBuilder w = new StringBuilder(" where user_id = ? and purpose = 'STUDY'");
        List<Object> p = new ArrayList<>(List.of(uid));
        if (subjectId != null) { w.append(" and subject_id = ?"); p.add(subjectId); }
        if (status != null && !status.isBlank()) { w.append(" and status = ?"); p.add(status); }
        if (q != null && !q.isBlank()) { w.append(" and title ilike ?"); p.add("%" + q.trim() + "%"); }
        long total = db.scalar("select count(*) from app.documents" + w, Long.class, p.toArray());
        p.add(size); p.add((long) page * size);
        var items = db.list("select id, title, subject_id, status, error_message, page_count, chunk_count, size_bytes, ocr_pages, created_at from app.documents"
                + w + " order by created_at desc limit ? offset ?", p.toArray());
        return Map.of("items", items, "page", page, "size", size, "total", total);
    }

    @GetMapping("/documents/{id}")
    public Map<String, Object> get(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> d = new LinkedHashMap<>(db.require("Document",
                "select id, title, subject_id, purpose, status, error_message, page_count, chunk_count, size_bytes, original_filename, mime_type, ocr_pages, created_at from app.documents where id=? and user_id=?", id, uid));
        d.put("topics", db.list("select id, parent_id, title, level, page_start, page_end, (summary is not null) as has_summary from app.topics where document_id=? order by order_index", id));
        d.put("latestJob", db.one("select id, status, stage, progress, error_message from app.jobs where resource_type='DOCUMENT' and resource_id=? order by created_at desc limit 1", id).orElse(null));
        return d;
    }

    @GetMapping("/documents/{id}/file")
    public ResponseEntity<InputStreamResource> file(@PathVariable UUID id) throws IOException {
        Map<String, Object> d = db.require("Document", "select storage_key, mime_type, original_filename, size_bytes from app.documents where id=? and user_id=?", id, UserPrincipal.currentId());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType((String) d.get("mimeType")))
                .contentLength(((Number) d.get("sizeBytes")).longValue())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", "inline; filename=\"" + ((String) d.get("originalFilename")).replace("\"", "") + "\"")
                .body(new InputStreamResource(storage.open((String) d.get("storageKey"))));
    }

    @PatchMapping("/documents/{id}")
    public Map<String, Object> patch(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        db.require("Document", "select id from app.documents where id=? and user_id=?", id, uid);
        if (b.get("title") != null && !b.get("title").toString().isBlank()) db.update("update app.documents set title=?, updated_at=now() where id=?", b.get("title").toString().trim(), id);
        if (b.containsKey("subjectId")) {
            Object s = b.get("subjectId");
            UUID sid = s == null || s.toString().isBlank() ? null : UUID.fromString(s.toString());
            if (sid != null) db.require("Subject", "select id from app.subjects where id=? and user_id=?", sid, uid);
            db.update("update app.documents set subject_id=?, updated_at=now() where id=?", sid, id);
        }
        return get(id);
    }

    @PostMapping("/documents/{id}/reprocess")
    public ResponseEntity<Map<String, Object>> reprocess(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> d = db.require("Document", "select purpose, status from app.documents where id=? and user_id=?", id, uid);
        if ("PROCESSING".equals(d.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_PROCESSING", "Document is already being processed");
        db.update("update app.documents set status='UPLOADED', error_message=null, updated_at=now() where id=?", id);
        String type = "RESUME".equals(d.get("purpose")) ? "PARSE_RESUME" : "INGEST_DOCUMENT";
        UUID jobId = jobs.create(uid, "AI_INGEST", type, "DOCUMENT", id, Map.of("documentId", id.toString()));
        return ResponseEntity.accepted().body(Map.of("jobId", jobId));
    }

    @DeleteMapping("/documents/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> d = db.require("Document", "select storage_key from app.documents where id=? and user_id=?", id, uid);
        db.update("update app.jobs set status='CANCELLED', updated_at=now() where resource_type='DOCUMENT' and resource_id=? and status='QUEUED'", id);
        db.update("delete from app.documents where id=?", id); // cascades chunks, topics, mastery
        storage.delete((String) d.get("storageKey"));
        return ResponseEntity.noContent().build();
    }
}
