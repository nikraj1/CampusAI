package com.campusai.system;

import com.campusai.aiclient.AiClient;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/system")
public class SystemController {
    private final AiClient ai;
    public SystemController(AiClient ai) { this.ai = ai; }

    @GetMapping("/status")
    public Map<String, Object> status() {
        JsonNode h = ai.get("/internal/health", Duration.ofSeconds(3));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("api", "UP");
        m.put("ai", h == null ? "DOWN" : h.path("status").asText("UNKNOWN"));
        m.put("llmConfigured", h != null && h.path("llmConfigured").asBoolean(false));
        m.put("providers", h == null ? null : h.path("providers"));
        return m;
    }
}
