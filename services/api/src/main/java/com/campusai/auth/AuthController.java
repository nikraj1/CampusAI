package com.campusai.auth;

import com.campusai.common.ApiException;
import com.campusai.config.AppProps;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    public record RegisterReq(@NotBlank @Email String email, @NotBlank @Size(max = 128) String password,
                              @NotBlank @Size(max = 120) String fullName) {}
    public record LoginReq(@NotBlank String email, @NotBlank String password) {}

    private static final String COOKIE = "campusai_refresh";
    private final AuthService auth;
    private final AppProps props;

    public AuthController(AuthService auth, AppProps props) { this.auth = auth; this.props = props; }

    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody RegisterReq r, HttpServletRequest req, HttpServletResponse res) {
        var issued = auth.register(r.email(), r.password(), r.fullName(), req.getHeader("User-Agent"));
        setCookie(res, issued.refreshToken(), props.refreshTtlDays() * 86400);
        return ResponseEntity.status(HttpStatus.CREATED).body(issued.body());
    }

    @PostMapping("/login")
    public Map<String, Object> login(@Valid @RequestBody LoginReq r, HttpServletRequest req, HttpServletResponse res) {
        var issued = auth.login(r.email(), r.password(), req.getRemoteAddr(), req.getHeader("User-Agent"));
        setCookie(res, issued.refreshToken(), props.refreshTtlDays() * 86400);
        return issued.body();
    }

    @PostMapping("/refresh")
    public Map<String, Object> refresh(HttpServletRequest req, HttpServletResponse res) {
        if (!"XMLHttpRequest".equals(req.getHeader("X-Requested-With")) && req.getHeader("X-Requested-With") == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING_HEADER", "X-Requested-With header required");
        }
        var issued = auth.refresh(readCookie(req), req.getHeader("User-Agent"));
        setCookie(res, issued.refreshToken(), props.refreshTtlDays() * 86400);
        return issued.body();
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest req, HttpServletResponse res) {
        auth.logout(readCookie(req));
        setCookie(res, "", 0);
        return ResponseEntity.noContent().build();
    }

    private String readCookie(HttpServletRequest req) {
        if (req.getCookies() == null) return null;
        for (Cookie c : req.getCookies()) if (COOKIE.equals(c.getName())) return c.getValue();
        return null;
    }

    private void setCookie(HttpServletResponse res, String value, int maxAge) {
        StringBuilder sb = new StringBuilder(COOKIE).append('=').append(value)
                .append("; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=").append(maxAge);
        if (props.cookieSecure()) sb.append("; Secure");
        res.addHeader("Set-Cookie", sb.toString());
    }
}
