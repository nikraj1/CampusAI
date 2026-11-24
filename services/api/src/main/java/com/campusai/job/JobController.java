package com.campusai.job;

import com.campusai.common.Db;
import com.campusai.security.UserPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class JobController {
    private final Db db;
    public JobController(Db db) { this.db = db; }

    private static final String COLS = "id, type, status, stage, progress, resource_type, resource_id, result, error_message, created_at, updated_at";

    @GetMapping("/jobs/{id}")
    public Map<String, Object> get(@PathVariable UUID id) {
        return db.require("Job", "select " + COLS + " from app.jobs where id = ? and user_id = ?", id, UserPrincipal.currentId());
    }

    @GetMapping("/jobs")
    public List<Map<String, Object>> list(@RequestParam(defaultValue = "false") boolean active) {
        String where = active ? " and status in ('QUEUED','RUNNING')" : "";
        return db.list("select " + COLS + " from app.jobs where user_id = ?" + where + " order by created_at desc limit 20", UserPrincipal.currentId());
    }

    @GetMapping("/agent-runs/{runId}")
    public Map<String, Object> trace(@PathVariable UUID runId) {
        UUID uid = UserPrincipal.currentId();
        Map<String, Object> run = new LinkedHashMap<>(db.require("Run",
                "select id, route, intents, plan, status, tokens_in, tokens_out, latency_ms, error_code, started_at from ai.agent_runs where id = ? and user_id = ?", runId, uid));
        run.put("steps", db.list("""
                select step_index, node, type, input_preview, output_preview, provider_model, prompt_version, tokens_in, tokens_out, latency_ms, status, error
                from ai.agent_steps where run_id = ? order by step_index""", runId));
        return run;
    }
}
