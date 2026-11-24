package com.campusai.aiclient;

import com.campusai.common.ApiException;
import com.campusai.common.Db;
import com.campusai.security.JwtService;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.function.BiConsumer;

/** Typed gateway to the FastAPI AI service (blueprint 5.3). User identity travels only in the signed service JWT. */
@Component
public class AiClient {
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).build();
    private final JwtService jwt;
    private final Db db;
    private final String baseUrl;

    public AiClient(JwtService jwt, Db db, @Value("${campusai.ai-service-url}") String baseUrl) {
        this.jwt = jwt; this.db = db; this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    private HttpRequest.Builder req(String path, UUID userId, boolean privateMode, Duration timeout) {
        String reqId = MDC.get("requestId");
        String token = jwt.serviceToken(userId, Map.of("privateMode", privateMode, "requestId", reqId == null ? "" : reqId));
        return HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(timeout)
                .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
                .header("X-Request-Id", reqId == null ? "" : reqId);
    }

    public boolean privateMode(UUID userId) {
        return db.one("select preferences from app.user_profiles where user_id = ?", userId)
                .map(m -> m.get("preferences")).filter(p -> p instanceof JsonNode)
                .map(p -> ((JsonNode) p).path("privateMode").asBoolean(false)).orElse(false);
    }

    /** Synchronous JSON call. */
    public JsonNode post(String path, UUID userId, Object body, Duration timeout) {
        try {
            HttpRequest r = req(path, userId, privateMode(userId), timeout)
                    .POST(HttpRequest.BodyPublishers.ofString(db.json(body))).build();
            HttpResponse<String> res = http.send(r, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() / 100 != 2) throw mapError(res.statusCode(), res.body());
            return db.parse(res.body());
        } catch (ApiException e) {
            throw e;
        } catch (java.net.http.HttpTimeoutException e) {
            throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "AI_TIMEOUT", "The AI service took too long to respond", true);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "AI_UNAVAILABLE", "The AI service is unavailable", true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "INTERRUPTED", "Request interrupted");
        }
    }

    public JsonNode get(String path, Duration timeout) {
        try {
            HttpRequest r = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(timeout).GET().build();
            HttpResponse<String> res = http.send(r, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return db.parse(res.body());
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Streams SSE from the AI service. The consumer receives (eventName, rawJsonData) and may throw IOException
     * (e.g. client disconnected) to abort the upstream request.
     */
    public void stream(String path, UUID userId, Object body, BiConsumer<String, String> onEvent) throws IOException {
        try {
            HttpRequest r = req(path, userId, privateMode(userId), Duration.ofSeconds(180))
                    .header("Accept", "text/event-stream").POST(HttpRequest.BodyPublishers.ofString(db.json(body))).build();
            HttpResponse<java.io.InputStream> res = http.send(r, HttpResponse.BodyHandlers.ofInputStream());
            if (res.statusCode() / 100 != 2) {
                String err = new String(res.body().readAllBytes(), StandardCharsets.UTF_8);
                throw mapError(res.statusCode(), err);
            }
            try (BufferedReader br = new BufferedReader(new InputStreamReader(res.body(), StandardCharsets.UTF_8))) {
                String event = "message";
                StringBuilder data = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    if (line.isEmpty()) {
                        if (data.length() > 0) onEvent.accept(event, data.toString());
                        event = "message";
                        data.setLength(0);
                    } else if (line.startsWith("event:")) {
                        event = line.substring(6).trim();
                    } else if (line.startsWith("data:")) {
                        if (data.length() > 0) data.append('\n');
                        data.append(line.substring(5).stripLeading());
                    }
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted", e);
        }
    }

    private ApiException mapError(int status, String body) {
        String code = "AI_ERROR", msg = "AI service error"; boolean retry = status >= 500 || status == 429;
        try {
            JsonNode n = db.parse(body);
            JsonNode d = n.has("detail") && n.get("detail").isObject() ? n.get("detail") : n;
            code = d.path("code").asText(code);
            msg = d.path("message").asText(msg);
            retry = d.path("retryable").asBoolean(retry);
        } catch (Exception ignored) { }
        HttpStatus st = status == 429 ? HttpStatus.TOO_MANY_REQUESTS : (status >= 400 && status < 500 ? HttpStatus.valueOf(status) : HttpStatus.BAD_GATEWAY);
        return new ApiException(st, code, msg, retry);
    }
}
