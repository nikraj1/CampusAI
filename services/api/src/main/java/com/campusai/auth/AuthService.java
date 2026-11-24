package com.campusai.auth;

import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.common.RateLimiter;
import com.campusai.config.AppProps;
import com.campusai.security.JwtService;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;

@Service
public class AuthService {
    public record Issued(Map<String, Object> body, String refreshToken) {}

    private static final SecureRandom RNG = new SecureRandom();
    private static final int MAX_FAILS = 5;
    private static final int LOCK_MINUTES = 15;

    private final Db db;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AppProps props;
    private final RateLimiter limiter;

    public AuthService(Db db, PasswordEncoder encoder, JwtService jwt, AppProps props, RateLimiter limiter) {
        this.db = db; this.encoder = encoder; this.jwt = jwt; this.props = props; this.limiter = limiter;
    }

    static String sha256(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static String newOpaqueToken() {
        byte[] b = new byte[32];
        RNG.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    static void validatePassword(String pw) {
        if (pw == null || pw.length() < 10) throw ApiException.badRequest("WEAK_PASSWORD", "Password must be at least 10 characters");
        if (pw.length() > 128) throw ApiException.badRequest("WEAK_PASSWORD", "Password must be at most 128 characters");
        Set<String> common = Set.of("password12", "1234567890", "qwertyuiop", "password123", "1234567891");
        if (common.contains(pw.toLowerCase())) throw ApiException.badRequest("WEAK_PASSWORD", "Password is too common");
    }

    @Transactional
    public Issued register(String email, String password, String fullName, String userAgent) {
        validatePassword(password);
        String e = email.trim().toLowerCase();
        if (db.scalar("select count(*) from app.users where email = ?", Long.class, e) > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "An account with this email already exists");
        }
        UUID id = db.scalar("insert into app.users(email, password_hash, full_name) values (?,?,?) returning id",
                UUID.class, e, encoder.encode(password), fullName.trim());
        db.update("insert into app.user_profiles(user_id) values (?)", id);
        return issue(id, "STUDENT", UUID.randomUUID(), userAgent);
    }

    public Issued login(String email, String password, String ip, String userAgent) {
        String e = email.trim().toLowerCase();
        limiter.check("login:" + ip + ":" + e, 10, 60);
        Optional<Map<String, Object>> u = db.one("select * from app.users where email = ? and status <> 'DELETED'", e);
        if (u.isEmpty()) {
            encoder.matches(password, "$2a$12$abcdefghijklmnopqrstuuJ6tqXQ5u0o8J5n8m5f5b7Yq0G9e8bYy"); // timing equalization
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password");
        }
        Map<String, Object> user = u.get();
        UUID id = (UUID) user.get("id");
        Object lu = user.get("lockedUntil");
        if (lu instanceof Instant t && t.isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.LOCKED, "ACCOUNT_LOCKED", "Account temporarily locked. Try again later.");
        }
        if (!encoder.matches(password, (String) user.get("passwordHash"))) {
            int fails = ((Number) user.get("failedLoginCount")).intValue() + 1;
            if (fails >= MAX_FAILS) {
                db.update("update app.users set failed_login_count = 0, locked_until = ? where id = ?",
                        OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(LOCK_MINUTES), id);
            } else {
                db.update("update app.users set failed_login_count = ? where id = ?", fails, id);
            }
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password");
        }
        db.update("update app.users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = ?", id);
        return issue(id, (String) user.get("role"), UUID.randomUUID(), userAgent);
    }

    // noRollbackFor: the family revocation on token reuse must be committed even though we then throw 401
    @Transactional(noRollbackFor = ApiException.class)
    public Issued refresh(String token, String userAgent) {
        if (token == null || token.isBlank()) throw new ApiException(HttpStatus.UNAUTHORIZED, "NO_REFRESH_TOKEN", "Not signed in");
        String hash = sha256(token);
        Map<String, Object> row = db.one("select * from app.refresh_tokens where token_hash = ?", hash)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Session expired"));
        UUID family = (UUID) row.get("familyId");
        if (row.get("revokedAt") != null) {
            // reuse of a rotated token => revoke the whole family
            db.update("update app.refresh_tokens set revoked_at = now() where family_id = ? and revoked_at is null", family);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_TOKEN_REUSED", "Session invalidated. Please sign in again.");
        }
        if (((Instant) row.get("expiresAt")).isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Session expired");
        }
        UUID userId = (UUID) row.get("userId");
        Map<String, Object> user = db.one("select id, role from app.users where id = ? and status = 'ACTIVE'", userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Session expired"));
        db.update("update app.refresh_tokens set revoked_at = now() where id = ?", row.get("id"));
        return issue(userId, (String) user.get("role"), family, userAgent);
    }

    public void logout(String token) {
        if (token == null || token.isBlank()) return;
        db.one("select family_id from app.refresh_tokens where token_hash = ?", sha256(token)).ifPresent(r ->
                db.update("update app.refresh_tokens set revoked_at = now() where family_id = ? and revoked_at is null", r.get("familyId")));
    }

    public void revokeAll(UUID userId) {
        db.update("update app.refresh_tokens set revoked_at = now() where user_id = ? and revoked_at is null", userId);
    }

    private Issued issue(UUID userId, String role, UUID family, String userAgent) {
        String refresh = newOpaqueToken();
        db.update("insert into app.refresh_tokens(user_id, token_hash, family_id, expires_at, user_agent) values (?,?,?,?,?)",
                userId, sha256(refresh), family, OffsetDateTime.now(ZoneOffset.UTC).plusDays(props.refreshTtlDays()),
                userAgent == null ? null : userAgent.substring(0, Math.min(255, userAgent.length())));
        Map<String, Object> user = db.require("User", "select id, email, full_name, role from app.users where id = ?", userId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("user", user);
        body.put("accessToken", jwt.accessToken(userId, role));
        body.put("expiresIn", jwt.accessTtlSeconds());
        return new Issued(body, refresh);
    }
}
