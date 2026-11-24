package com.campusai.user;

import com.campusai.auth.AuthService;
import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.config.AppProps;
import com.campusai.security.UserPrincipal;
import com.campusai.storage.FileStorage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class UserController {
    public record NameReq(@NotBlank @Size(max = 120) String fullName) {}
    public record PasswordReq(@NotBlank String currentPassword, @NotBlank String newPassword) {}
    public record DeleteReq(@NotBlank String password) {}

    private final Db db;
    private final PasswordEncoder encoder;
    private final AuthService auth;
    private final FileStorage storage;
    private final AppProps props;

    public UserController(Db db, PasswordEncoder encoder, AuthService auth, FileStorage storage, AppProps props) {
        this.db = db; this.encoder = encoder; this.auth = auth; this.storage = storage; this.props = props;
    }

    @GetMapping("/users/me")
    public Map<String, Object> me() {
        UUID id = UserPrincipal.currentId();
        Map<String, Object> u = db.require("User", "select id, email, full_name, role, created_at from app.users where id = ?", id);
        Map<String, Object> out = new LinkedHashMap<>(u);
        out.put("profile", db.one("select * from app.user_profiles where user_id = ?", id).orElse(Map.of()));
        return out;
    }

    @PatchMapping("/users/me")
    public Map<String, Object> rename(@Valid @RequestBody NameReq r) {
        db.update("update app.users set full_name = ?, updated_at = now() where id = ?", r.fullName().trim(), UserPrincipal.currentId());
        return me();
    }

    @PutMapping("/users/me/profile")
    public Map<String, Object> profile(@RequestBody Map<String, Object> b) {
        UUID id = UserPrincipal.currentId();
        Object exp = b.get("experienceLevel");
        if (exp != null && !List.of("FRESHER", "INTERN", "JUNIOR").contains(exp.toString())) {
            throw ApiException.badRequest("VALIDATION_ERROR", "experienceLevel must be FRESHER, INTERN or JUNIOR");
        }
        Object gy = b.get("graduationYear");
        db.update("""
                update app.user_profiles set college=?, degree=?, branch=?, graduation_year=?, target_role=?, experience_level=?,
                preferences = ?::jsonb, updated_at = now() where user_id = ?""",
                str(b.get("college")), str(b.get("degree")), str(b.get("branch")),
                gy == null || gy.toString().isBlank() ? null : Integer.valueOf(gy.toString()),
                str(b.get("targetRole")), exp == null ? null : exp.toString(),
                db.json(b.getOrDefault("preferences", Map.of())), id);
        return me();
    }

    private static String str(Object o) { return o == null || o.toString().isBlank() ? null : o.toString().trim(); }

    @PutMapping("/users/me/password")
    public ResponseEntity<Void> password(@Valid @RequestBody PasswordReq r) {
        UUID id = UserPrincipal.currentId();
        String hash = db.scalar("select password_hash from app.users where id = ?", String.class, id);
        if (!encoder.matches(r.currentPassword(), hash)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Current password is incorrect");
        }
        AuthPasswordPolicy.validate(r.newPassword());
        db.update("update app.users set password_hash = ?, updated_at = now() where id = ?", encoder.encode(r.newPassword()), id);
        auth.revokeAll(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/users/me/usage")
    public Map<String, Object> usage() {
        UUID id = UserPrincipal.currentId();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("storageUsedBytes", db.scalar("select coalesce(sum(size_bytes),0) from app.documents where user_id = ?", Long.class, id));
        m.put("storageQuotaBytes", props.storageQuotaBytes());
        m.put("tokensToday", db.scalar("select coalesce(sum(tokens_in+tokens_out),0) from ai.agent_runs where user_id = ? and started_at > now() - interval '1 day'", Long.class, id));
        m.put("documents", db.scalar("select count(*) from app.documents where user_id = ? and purpose='STUDY'", Long.class, id));
        m.put("repositories", db.scalar("select count(*) from app.repositories where user_id = ?", Long.class, id));
        return m;
    }

    @DeleteMapping("/users/me")
    public ResponseEntity<Void> delete(@Valid @RequestBody DeleteReq r) {
        UUID id = UserPrincipal.currentId();
        String hash = db.scalar("select password_hash from app.users where id = ?", String.class, id);
        if (!encoder.matches(r.password(), hash)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Password is incorrect");
        }
        db.update("delete from app.users where id = ?", id); // cascades to every table in both schemas
        storage.deleteUserDir(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/admin/stats")
    public Map<String, Object> adminStats() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("users", db.scalar("select count(*) from app.users", Long.class));
        m.put("documents", db.scalar("select count(*) from app.documents", Long.class));
        m.put("repositories", db.scalar("select count(*) from app.repositories", Long.class));
        m.put("runs24h", db.scalar("select count(*) from ai.agent_runs where started_at > now() - interval '1 day'", Long.class));
        m.put("failedRuns24h", db.scalar("select count(*) from ai.agent_runs where status='FAILED' and started_at > now() - interval '1 day'", Long.class));
        m.put("runsByAgent", db.list("select route, count(*) as n, coalesce(avg(latency_ms),0)::int as avg_latency_ms from ai.agent_runs group by route"));
        return m;
    }
}
