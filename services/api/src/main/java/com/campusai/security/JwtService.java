package com.campusai.security;

import com.campusai.config.AppProps;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

/** Issues/validates user access tokens and mints short-lived service tokens for the AI service. */
@Service
public class JwtService {
    public static final String SERVICE_AUDIENCE = "campusai-ai";
    public static final String SERVICE_ISSUER = "campusai-api";

    private final SecretKey userKey;
    private final SecretKey serviceKey;
    private final AppProps props;

    public JwtService(AppProps props) {
        this.props = props;
        this.userKey = Keys.hmacShaKeyFor(pad(props.jwtSecret()));
        this.serviceKey = Keys.hmacShaKeyFor(pad(props.aiServiceJwtSecret()));
    }

    private static byte[] pad(String s) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        if (b.length >= 32) return b;
        throw new IllegalStateException("JWT secrets must be at least 32 bytes");
    }

    public String accessToken(UUID userId, String role) {
        Instant now = Instant.now();
        return Jwts.builder().subject(userId.toString()).claim("role", role).id(UUID.randomUUID().toString())
                .issuedAt(Date.from(now)).expiration(Date.from(now.plus(Duration.ofMinutes(props.accessTtlMinutes()))))
                .signWith(userKey, Jwts.SIG.HS256).compact();
    }

    /** @return claims or null when invalid/expired. */
    public Claims parseAccess(String token) {
        try {
            return Jwts.parser().verifyWith(userKey).build().parseSignedClaims(token).getPayload();
        } catch (Exception e) {
            return null;
        }
    }

    public String serviceToken(UUID userId, Map<String, Object> extraClaims) {
        Instant now = Instant.now();
        var b = Jwts.builder().subject(userId.toString()).audience().add(SERVICE_AUDIENCE).and()
                .issuer(SERVICE_ISSUER).issuedAt(Date.from(now)).expiration(Date.from(now.plusSeconds(120)));
        extraClaims.forEach(b::claim);
        return b.signWith(serviceKey, Jwts.SIG.HS256).compact();
    }

    public int accessTtlSeconds() { return props.accessTtlMinutes() * 60; }
}
