package com.campusai.project;

import com.campusai.common.ApiException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class RepoUrlTest {
    @Test
    void parsesUrls() {
        assertArrayEquals(new String[]{"spring-projects", "spring-petclinic", null}, ProjectController.parseRepo("https://github.com/spring-projects/spring-petclinic", null));
        assertArrayEquals(new String[]{"o", "r", null}, ProjectController.parseRepo("github.com/o/r.git", null));
        assertArrayEquals(new String[]{"o", "r", "dev"}, ProjectController.parseRepo("https://github.com/o/r/tree/dev", null));
        assertArrayEquals(new String[]{"o", "r", null}, ProjectController.parseRepo(null, "o/r"));
    }

    @Test
    void rejectsNonGithubAndInjection() {
        assertThrows(ApiException.class, () -> ProjectController.parseRepo("https://evil.com/o/r", null));
        assertThrows(ApiException.class, () -> ProjectController.parseRepo("https://github.com/o/r; rm -rf /", null));
        assertThrows(ApiException.class, () -> ProjectController.parseRepo(null, "not a repo"));
    }
}
