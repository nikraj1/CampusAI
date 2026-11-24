package com.campusai.conversation;

import com.campusai.aiclient.AiClient;
import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.common.RateLimiter;
import com.campusai.security.UserPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController
@RequestMapping("/api/v1/conversations")
public class ConversationController {
    private static final Logger log = LoggerFactory.getLogger(ConversationController.class);
    public record SendReq(@NotBlank @Size(max = 8000) String content) {}

    private final Db db;
    private final AiClient ai;
    private final RateLimiter limiter;

    public ConversationController(Db db, AiClient ai, RateLimiter limiter) { this.db = db; this.ai = ai; this.limiter = limiter; }

    private Map<String, Object> owned(UUID id, UUID uid) {
        return db.require("Conversation", "select * from app.conversations where id=? and user_id=?", id, uid);
    }

    /** Verifies every ID in scope belongs to the caller (isolation layer 1, blueprint 11.3). */
    private Map<String, Object> validateScope(Map<String, Object> scope, UUID uid) {
        Map<String, Object> clean = new LinkedHashMap<>();
        if (scope == null) return clean;
        if (scope.get("documentIds") instanceof List<?> l && !l.isEmpty()) {
            List<String> ids = new ArrayList<>();
            for (Object o : l) {
                UUID d = UUID.fromString(o.toString());
                db.require("Document", "select id from app.documents where id=? and user_id=?", d, uid);
                ids.add(d.toString());
            }
            clean.put("documentIds", ids);
        }
        for (var e : Map.of("subjectId", "app.subjects", "repositoryId", "app.repositories", "jobDescriptionId", "app.job_descriptions").entrySet()) {
            Object v = scope.get(e.getKey());
            if (v != null && !v.toString().isBlank()) {
                UUID x = UUID.fromString(v.toString());
                db.require(e.getKey(), "select id from " + e.getValue() + " where id=? and user_id=?", x, uid);
                clean.put(e.getKey(), x.toString());
            }
        }
        return clean;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        String module = b.get("module") == null ? "GENERAL" : b.get("module").toString().toUpperCase();
        if (!List.of("GENERAL", "STUDY", "CAREER", "PROJECT").contains(module)) throw ApiException.badRequest("VALIDATION_ERROR", "Invalid module");
        @SuppressWarnings("unchecked") Map<String, Object> scope = validateScope(b.get("scope") instanceof Map ? (Map<String, Object>) b.get("scope") : null, uid);
        String title = b.get("title") == null ? null : b.get("title").toString();
        UUID id = db.scalar("insert into app.conversations(user_id, module, title, scope) values (?,?,?,?::jsonb) returning id", UUID.class, uid, module, title, db.json(scope));
        return ResponseEntity.status(201).body(owned(id, uid));
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String module, @RequestParam(defaultValue = "false") boolean archived,
                                    @RequestParam(defaultValue = "0") int page) {
        UUID uid = UserPrincipal.currentId();
        List<Object> p = new ArrayList<>(List.of(uid, archived));
        String m = "";
        if (module != null && !module.isBlank()) { m = " and c.module = ?"; p.add(module.toUpperCase()); }
        p.add(page * 30L);
        var items = db.list("""
                select c.id, c.module, c.title, c.scope, c.updated_at,
                  (select left(content, 100) from app.messages x where x.conversation_id=c.id order by x.created_at desc limit 1) as last_message_preview
                from app.conversations c where c.user_id=? and c.archived=?""" + m + " order by c.updated_at desc limit 30 offset ?", p.toArray());
        return Map.of("items", items, "page", page);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable UUID id) { return owned(id, UserPrincipal.currentId()); }

    @PatchMapping("/{id}")
    public Map<String, Object> patch(@PathVariable UUID id, @RequestBody Map<String, Object> b) {
        UUID uid = UserPrincipal.currentId();
        owned(id, uid);
        if (b.get("title") != null) db.update("update app.conversations set title=?, updated_at=now() where id=?", b.get("title").toString(), id);
        if (b.get("archived") != null) db.update("update app.conversations set archived=? where id=?", Boolean.parseBoolean(b.get("archived").toString()), id);
        if (b.get("scope") instanceof Map<?, ?> s) {
            @SuppressWarnings("unchecked") Map<String, Object> clean = validateScope((Map<String, Object>) s, uid);
            db.update("update app.conversations set scope=?::jsonb, updated_at=now() where id=?", db.json(clean), id);
        }
        return owned(id, uid);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        owned(id, UserPrincipal.currentId());
        db.update("delete from app.conversations where id=?", id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/messages")
    public List<Map<String, Object>> messages(@PathVariable UUID id, @RequestParam(required = false) String before,
                                              @RequestParam(defaultValue = "50") int limit) {
        owned(id, UserPrincipal.currentId());
        limit = Math.min(Math.max(limit, 1), 200);
        List<Map<String, Object>> rows = before == null || before.isBlank()
                ? db.list("select id, role, content, citations, agent, run_id, status, grounded, feedback, created_at from (select * from app.messages where conversation_id=? order by created_at desc limit ?) t order by created_at", id, limit)
                : db.list("select id, role, content, citations, agent, run_id, status, grounded, feedback, created_at from (select * from app.messages where conversation_id=? and created_at < ?::timestamptz order by created_at desc limit ?) t order by created_at", id, before, limit);
        return rows;
    }

    @PostMapping("/{id}/messages/{msgId}/feedback")
    public ResponseEntity<Void> feedback(@PathVariable UUID id, @PathVariable UUID msgId, @RequestBody Map<String, Object> b) {
        owned(id, UserPrincipal.currentId());
        int rating = Integer.parseInt(String.valueOf(b.get("rating")));
        if (rating != 1 && rating != -1) throw ApiException.badRequest("VALIDATION_ERROR", "rating must be 1 or -1");
        int n = db.update("update app.messages set feedback=?, feedback_comment=? where id=? and conversation_id=?", rating, b.get("comment"), msgId, id);
        if (n == 0) throw ApiException.notFound("Message");
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/{id}/messages", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> send(@PathVariable UUID id, @Valid @RequestBody SendReq req) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> conv = owned(id, uid);
        limiter.check("msg-min:" + uid, 15, 60);
        limiter.check("msg-day:" + uid, 300, 86400);
        UUID userMsg = db.scalar("insert into app.messages(conversation_id, role, content) values (?,'USER',?) returning id", UUID.class, id, req.content());
        UUID asstMsg = db.scalar("insert into app.messages(conversation_id, role, content, status) values (?,'ASSISTANT','', 'STREAMING') returning id", UUID.class, id);
        if (conv.get("title") == null) {
            String t = req.content().strip().replaceAll("\\s+", " ");
            db.update("update app.conversations set title=? where id=?", t.substring(0, Math.min(60, t.length())), id);
        }
        db.update("update app.conversations set updated_at=now() where id=?", id);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("conversationId", id.toString());
        body.put("userMessageId", userMsg.toString());
        body.put("assistantMessageId", asstMsg.toString());
        body.put("module", conv.get("module"));
        body.put("scope", conv.get("scope"));
        body.put("content", req.content());

        StreamingResponseBody stream = out -> {
            StringBuilder text = new StringBuilder();
            Object[] meta = new Object[]{"[]", null, null, null}; // citations json, runId, agent, grounded
            String[] status = {"COMPLETE"};
            try {
                ai.stream("/internal/v1/chat/stream", uid, body, (event, data) -> {
                    try {
                        JsonNode n = db.parse(data);
                        switch (event) {
                            case "token" -> text.append(n.path("t").asText());
                            case "citations" -> meta[0] = n.path("citations").toString();
                            case "run_started" -> { meta[1] = n.path("runId").asText(null); meta[2] = n.path("agent").asText(null); }
                            case "done" -> { if (n.has("grounded") && !n.get("grounded").isNull()) meta[3] = n.get("grounded").asBoolean(); if (n.hasNonNull("runId")) meta[1] = n.get("runId").asText(); if (n.hasNonNull("agent")) meta[2] = n.get("agent").asText(); }
                            case "agent" -> meta[2] = n.path("agent").asText(null);
                            case "error" -> status[0] = "ERROR";
                            default -> { }
                        }
                        write(out, event, data);
                    } catch (IOException e) {
                        throw new java.io.UncheckedIOException(e);
                    }
                });
            } catch (java.io.UncheckedIOException | IOException e) {
                status[0] = "INCOMPLETE"; // client disconnected
                log.info("Chat stream aborted for conversation {}: {}", id, e.getMessage());
            } catch (ApiException e) {
                status[0] = "ERROR";
                if (text.length() == 0) text.append("⚠ ").append(e.getMessage());
                try { write(out, "error", db.json(Map.of("code", e.code(), "message", e.getMessage(), "retryable", e.retryable()))); } catch (IOException ignored) { }
            } catch (Exception e) {
                status[0] = "ERROR";
                log.error("Chat stream failed", e);
                try { write(out, "error", db.json(Map.of("code", "INTERNAL_ERROR", "message", "Unexpected error", "retryable", true))); } catch (IOException ignored) { }
            } finally {
                UUID run = null;
                try { if (meta[1] != null) run = UUID.fromString((String) meta[1]); } catch (Exception ignored) { }
                db.update("update app.messages set content=?, status=?, citations=?::jsonb, run_id=?, agent=?, grounded=? where id=?",
                        text.toString(), status[0], (String) meta[0], run, meta[2], meta[3], asstMsg);
            }
        };
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-cache").header("X-Accel-Buffering", "no").body(stream);
    }

    private static void write(OutputStream out, String event, String data) throws IOException {
        out.write(("event: " + event + "\ndata: " + data.replace("\n", "\\n") + "\n\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
    }
}
