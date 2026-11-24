package com.campusai;

import com.campusai.config.AppProps;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(AppProps.class)
public class CampusAiApplication {
    public static void main(String[] args) {
        // All timestamps are stored/handled in UTC; also avoids legacy zone ids (e.g. Asia/Calcutta) that PostgreSQL rejects.
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        SpringApplication.run(CampusAiApplication.class, args);
    }
}
