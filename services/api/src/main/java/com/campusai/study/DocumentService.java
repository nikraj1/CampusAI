package com.campusai.study;

import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.common.RateLimiter;
import com.campusai.config.AppProps;
import com.campusai.job.JobService;
import com.campusai.storage.FileStorage;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Validates, stores and registers an uploaded file (study material or resume) and enqueues its ingestion job. */
@Service
public class DocumentService {
    public record Uploaded(UUID documentId, UUID jobId) {}

    private final Db db;
    private final FileStorage storage;
    private final JobService jobs;
    private final AppProps props;
    private final RateLimiter limiter;

    public DocumentService(Db db, FileStorage storage, JobService jobs, AppProps props, RateLimiter limiter) {
        this.db = db; this.storage = storage; this.jobs = jobs; this.props = props; this.limiter = limiter;
    }

    /** Detects type from magic bytes, never from extension or Content-Type. */
    static String detectExt(byte[] head, String filename) {
        if (head.length >= 5 && head[0] == '%' && head[1] == 'P' && head[2] == 'D' && head[3] == 'F' && head[4] == '-') return "pdf";
        boolean zip = head.length >= 4 && head[0] == 0x50 && head[1] == 0x4B && head[2] == 0x03 && head[3] == 0x04;
        if (zip && filename != null && filename.toLowerCase().endsWith(".docx")) return "docx";
        return null;
    }

    static String mimeFor(String ext) {
        return ext.equals("pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    static String sanitize(String name) {
        String n = name == null ? "file" : name.replaceAll("[\\\\/]+", "_").replaceAll("[^\\w .()\\-]", "_");
        return n.substring(0, Math.min(200, n.length()));
    }

    public Uploaded upload(UUID userId, MultipartFile file, String purpose, String title, UUID subjectId) {
        return upload(userId, file, purpose, title, subjectId, null);
    }

    /** @param beforeJob runs after the document row exists and before the ingestion job is enqueued. */
    public Uploaded upload(UUID userId, MultipartFile file, String purpose, String title, UUID subjectId,
                           java.util.function.Consumer<UUID> beforeJob) {
        limiter.check("upload:" + userId, 20, 3600);
        if (file == null || file.isEmpty()) throw ApiException.badRequest("EMPTY_FILE", "No file provided");
        if (file.getSize() > 25L * 1024 * 1024 || (purpose.equals("RESUME") && file.getSize() > 5L * 1024 * 1024)) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", purpose.equals("RESUME") ? "Resume exceeds 5 MB" : "File exceeds 25 MB");
        }
        long used = db.scalar("select coalesce(sum(size_bytes),0) from app.documents where user_id = ?", Long.class, userId);
        if (used + file.getSize() > props.storageQuotaBytes()) {
            throw new ApiException(HttpStatus.valueOf(413), "STORAGE_QUOTA_EXCEEDED", "Storage quota exceeded. Delete some documents first.");
        }
        if (subjectId != null) db.require("Subject", "select id from app.subjects where id = ? and user_id = ?", subjectId, userId);

        UUID docId = UUID.randomUUID();
        String key;
        String sha;
        String ext;
        try (InputStream in = file.getInputStream()) {
            byte[] all = in.readAllBytes();
            ext = detectExt(Arrays.copyOf(all, Math.min(all.length, 8)), file.getOriginalFilename());
            if (ext == null) throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_TYPE", "Only PDF and DOCX files are supported");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest(all)) sb.append(String.format("%02x", b));
            sha = sb.toString();
            Optional<Map<String, Object>> dup = db.one("select id from app.documents where user_id=? and sha256=? and purpose=?", userId, sha, purpose);
            if (dup.isPresent()) {
                throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_DOCUMENT", "You already uploaded this file (id " + dup.get().get("id") + ")");
            }
            key = storage.save(userId, docId, ext, new java.io.ByteArrayInputStream(all));
        } catch (IOException | java.security.NoSuchAlgorithmException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "UPLOAD_ERROR", "Could not read upload");
        }
        String name = sanitize(file.getOriginalFilename());
        String t = title == null || title.isBlank() ? name.replaceFirst("\\.[^.]+$", "") : title.trim();
        db.update("""
                insert into app.documents(id, user_id, subject_id, purpose, title, original_filename, mime_type, size_bytes, sha256, storage_key, status)
                values (?,?,?,?,?,?,?,?,?,?,'UPLOADED')""",
                docId, userId, subjectId, purpose, t, name, mimeFor(ext), file.getSize(), sha, key);
        if (beforeJob != null) beforeJob.accept(docId);
        String jobType = purpose.equals("RESUME") ? "PARSE_RESUME" : "INGEST_DOCUMENT";
        UUID jobId = jobs.create(userId, "AI_INGEST", jobType, "DOCUMENT", docId, Map.of("documentId", docId.toString()));
        return new Uploaded(docId, jobId);
    }
}
