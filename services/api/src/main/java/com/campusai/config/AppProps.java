package com.campusai.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "campusai")
public record AppProps(
        String jwtSecret,
        int accessTtlMinutes,
        int refreshTtlDays,
        String aiServiceUrl,
        String aiServiceJwtSecret,
        String fileStorageDir,
        boolean cookieSecure,
        String corsOrigins,
        long storageQuotaBytes) {
}
