package com.campusai.common;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.net.URI;
import java.util.stream.Collectors;

/** Maps exceptions to RFC 7807 application/problem+json with a stable `code` and `requestId`. */
@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private ResponseEntity<ProblemDetail> problem(HttpStatus st, String code, String detail, boolean retryable) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(st, detail);
        pd.setTitle(st.getReasonPhrase());
        pd.setType(URI.create("https://campusai.local/problems/" + code.toLowerCase()));
        pd.setProperty("code", code);
        pd.setProperty("retryable", retryable);
        pd.setProperty("requestId", MDC.get("requestId"));
        return ResponseEntity.status(st).header("Content-Type", "application/problem+json").body(pd);
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ProblemDetail> api(ApiException e) {
        return problem(e.status(), e.code(), e.getMessage(), e.retryable());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> validation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage()).collect(Collectors.joining("; "));
        return problem(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", msg, false);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ProblemDetail> missingParam(MissingServletRequestParameterException e) {
        return problem(HttpStatus.BAD_REQUEST, "MISSING_PARAMETER", "Missing required parameter: " + e.getParameterName(), false);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemDetail> unreadable(HttpMessageNotReadableException e) {
        return problem(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST", "Malformed request body", false);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ProblemDetail> methodNotAllowed(HttpRequestMethodNotSupportedException e) {
        return problem(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", e.getMessage(), false);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ProblemDetail> notFound(NoResourceFoundException e) {
        return problem(HttpStatus.NOT_FOUND, "NOT_FOUND", "Endpoint not found", false);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ProblemDetail> tooLarge(MaxUploadSizeExceededException e) {
        return problem(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", "File exceeds the 25 MB limit", false);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ProblemDetail> denied(AccessDeniedException e) {
        return problem(HttpStatus.FORBIDDEN, "FORBIDDEN", "Access denied", false);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> other(Exception e, HttpServletRequest req) {
        log.error("Unhandled error on {} {}", req.getMethod(), req.getRequestURI(), e);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Unexpected server error", false);
    }
}
