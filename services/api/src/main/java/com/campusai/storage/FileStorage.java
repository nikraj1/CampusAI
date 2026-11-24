package com.campusai.storage;

import com.campusai.common.ApiException;
import com.campusai.config.AppProps;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.util.Comparator;
import java.util.UUID;
import java.util.stream.Stream;

/** Local-disk storage. Keys look like {userId}/{documentId}.{ext}. Swap for S3-compatible by implementing the same methods. */
@Component
public class FileStorage {
    private final Path root;

    public FileStorage(AppProps props) throws IOException {
        this.root = Paths.get(props.fileStorageDir()).toAbsolutePath().normalize();
        Files.createDirectories(root);
    }

    public String save(UUID userId, UUID docId, String ext, InputStream in) {
        try {
            String key = userId + "/" + docId + "." + ext;
            Path p = resolve(key);
            Files.createDirectories(p.getParent());
            Files.copy(in, p, StandardCopyOption.REPLACE_EXISTING);
            return key;
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_ERROR", "Could not store file");
        }
    }

    public Path resolve(String key) {
        Path p = root.resolve(key).normalize();
        if (!p.startsWith(root)) throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_KEY", "Invalid storage key");
        return p;
    }

    public InputStream open(String key) throws IOException { return Files.newInputStream(resolve(key)); }

    public void delete(String key) {
        try { Files.deleteIfExists(resolve(key)); } catch (IOException ignored) { }
    }

    public void deleteUserDir(UUID userId) {
        Path d = root.resolve(userId.toString()).normalize();
        if (!Files.exists(d) || !d.startsWith(root)) return;
        try (Stream<Path> s = Files.walk(d)) {
            s.sorted(Comparator.reverseOrder()).forEach(p -> { try { Files.delete(p); } catch (IOException ignored) { } });
        } catch (IOException ignored) { }
    }
}
