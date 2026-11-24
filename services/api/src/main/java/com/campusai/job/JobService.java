package com.campusai.job;

import com.campusai.common.Db;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.function.Function;

/**
 * Job records for both queues. AI_INGEST jobs are claimed by the Python worker (SKIP LOCKED);
 * API_TASK jobs run on a virtual-thread executor inside this process (I/O-bound calls to the AI service).
 */
@Service
public class JobService {
    private static final Logger log = LoggerFactory.getLogger(JobService.class);
    private final Db db;
    private final ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor();
    private final Semaphore concurrency = new Semaphore(4);

    public JobService(Db db) { this.db = db; }

    @PostConstruct
    void reapStuck() {
        int n = db.update("update app.jobs set status='FAILED', error_message='Server restarted while running', updated_at=now() where queue='API_TASK' and status in ('RUNNING','QUEUED')");
        if (n > 0) log.warn("Marked {} orphaned API_TASK jobs as FAILED", n);
        int m = db.update("update app.messages set status='INCOMPLETE' where status='STREAMING'");
        if (m > 0) log.warn("Marked {} interrupted chat messages as INCOMPLETE", m);
    }

    public UUID create(UUID userId, String queue, String type, String resourceType, UUID resourceId, Map<String, Object> payload) {
        return db.scalar("""
                insert into app.jobs(user_id, queue, type, resource_type, resource_id, payload) values (?,?,?,?,?,?::jsonb) returning id""",
                UUID.class, userId, queue, type, resourceType, resourceId, db.json(payload == null ? Map.of() : payload));
    }

    /** Creates an API_TASK job and runs the task asynchronously. The task returns the job result map. */
    public UUID submit(UUID userId, String type, String resourceType, UUID resourceId, Map<String, Object> payload,
                       Function<UUID, Map<String, Object>> task, java.util.function.BiConsumer<UUID, String> onFailure) {
        UUID jobId = create(userId, "API_TASK", type, resourceType, resourceId, payload);
        exec.submit(() -> {
            try {
                concurrency.acquire();
            } catch (InterruptedException e) { return; }
            try {
                db.update("update app.jobs set status='RUNNING', locked_by='api', locked_at=now(), attempts=attempts+1, updated_at=now() where id=?", jobId);
                Map<String, Object> result = task.apply(jobId);
                db.update("update app.jobs set status='SUCCEEDED', progress=100, result=?::jsonb, updated_at=now() where id=?", db.json(result), jobId);
            } catch (Exception e) {
                String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                log.warn("Job {} ({}) failed: {}", jobId, type, msg);
                db.update("update app.jobs set status='FAILED', error_message=?, updated_at=now() where id=?", trunc(msg, 900), jobId);
                try { if (onFailure != null) onFailure.accept(jobId, msg); } catch (Exception ex) { log.warn("onFailure hook failed", ex); }
            } finally {
                concurrency.release();
            }
        });
        return jobId;
    }

    public void progress(UUID jobId, String stage, int pct) {
        db.update("update app.jobs set stage=?, progress=?, updated_at=now() where id=?", stage, pct, jobId);
    }

    public static String trunc(String s, int n) { return s == null ? null : s.substring(0, Math.min(n, s.length())); }

    public JsonNode toJson(Object o) { return db.mapper().valueToTree(o); }
}
