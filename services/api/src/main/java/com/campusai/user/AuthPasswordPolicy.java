package com.campusai.user;

import com.campusai.common.ApiException;

import java.util.Set;

final class AuthPasswordPolicy {
    private AuthPasswordPolicy() {}

    static void validate(String pw) {
        if (pw == null || pw.length() < 10) throw ApiException.badRequest("WEAK_PASSWORD", "Password must be at least 10 characters");
        if (pw.length() > 128) throw ApiException.badRequest("WEAK_PASSWORD", "Password must be at most 128 characters");
        if (Set.of("password12", "1234567890", "qwertyuiop", "password123").contains(pw.toLowerCase())) {
            throw ApiException.badRequest("WEAK_PASSWORD", "Password is too common");
        }
    }
}
