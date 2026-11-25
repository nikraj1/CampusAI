package com.campusai.common;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** Minimal in-memory fixed-window rate limiter with bounded memory eviction (single instance deployment, see blueprint 8.11). */
@Component
public class RateLimiter {
    private record Window(long start, long expiresAt, int count) {}

    private static final int CLEANUP_THRESHOLD = 1_000;
    private static final long CLEANUP_INTERVAL_MS = 60_000;

    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    private final AtomicLong lastCleanup = new AtomicLong(0);

    public void check(String key, int limit, long windowSeconds) {
        long now = System.currentTimeMillis();
        long w = windowSeconds * 1000;
        maybeCleanup(now);
        Window cur = windows.compute(key, (k, v) -> {
            if (v == null || now - v.start >= w) return new Window(now, now + w, 1);
            return new Window(v.start, v.expiresAt, v.count + 1);
        });
        if (cur.count > limit) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED",
                    "Too many requests. Please slow down and try again shortly.", true);
        }
    }

    private void maybeCleanup(long now) {
        if (windows.size() < CLEANUP_THRESHOLD) return;
        long prev = lastCleanup.get();
        if (now - prev >= CLEANUP_INTERVAL_MS && lastCleanup.compareAndSet(prev, now)) {
            windows.entrySet().removeIf(e -> e.getValue().expiresAt <= now);
        }
    }

    public void clear() { windows.clear(); }
}
