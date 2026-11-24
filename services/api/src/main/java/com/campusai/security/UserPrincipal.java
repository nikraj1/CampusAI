package com.campusai.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.UUID;

public record UserPrincipal(UUID id, String role) {
    public static UUID currentId() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null || !(a.getPrincipal() instanceof UserPrincipal p)) {
            throw new IllegalStateException("No authenticated user");
        }
        return p.id();
    }
}
