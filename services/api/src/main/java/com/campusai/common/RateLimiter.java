package com.campusai.common;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

/** Minimal in-memory fixed-window rate limiter (single instance deployment, see blueprint 8.11). */
@Component
public class RateLimiter {
    private record Window(long start, int count) {}
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    public void check(String key, int limit, long windowSeconds) {
        long now = System.currentTimeMillis();
        long w = windowSeconds * 1000;
        Window cur = windows.compute(key, (k, v) -> {
            if (v == null || now - v.start >= w) return new Window(now, 1);
            return new Window(v.start, v.count + 1);
        });
        if (cur.count > limit) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED",
                    "Too many requests. Please slow down and try again shortly.", true);
        }
    }

    public void clear() { windows.clear(); }
}
