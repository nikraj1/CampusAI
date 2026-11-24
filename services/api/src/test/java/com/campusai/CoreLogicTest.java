package com.campusai;

import com.campusai.config.AppProps;
import com.campusai.security.JwtService;
import com.campusai.study.MasteryCalculator;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class CoreLogicTest {
    @Test
    void masteryMovesTowardScoreAndStaysBounded() {
        double up = MasteryCalculator.update(0.5, 1.0, 1.0);
        assertEquals(0.65, up, 1e-9);
        double down = MasteryCalculator.update(0.5, 0.0, 1.2);
        assertEquals(0.5 - 0.3 * 1.2 * 0.5, down, 1e-9);
        assertTrue(MasteryCalculator.update(0.99, 1.0, 1.2) <= 1.0);
        assertTrue(MasteryCalculator.update(0.01, 0.0, 1.2) >= 0.0);
    }

    @Test
    void difficultyWeights() {
        assertEquals(0.8, MasteryCalculator.difficultyWeight("easy"));
        assertEquals(1.0, MasteryCalculator.difficultyWeight("MEDIUM"));
        assertEquals(1.2, MasteryCalculator.difficultyWeight("HARD"));
    }

    @Test
    void multiSelectScoringRequiresExactSet() {
        assertTrue(MasteryCalculator.isCorrect(List.of(2, 0), List.of(0, 2)));
        assertFalse(MasteryCalculator.isCorrect(List.of(0), List.of(0, 2)));
        assertFalse(MasteryCalculator.isCorrect(List.of(), List.of(1)));
    }

    @Test
    void jwtRoundTripAndTamperRejected() {
        AppProps p = new AppProps("0123456789abcdef0123456789abcdef-user", 15, 7, "http://x", "0123456789abcdef0123456789abcdef-svc", "./data", false, "*", 1);
        JwtService jwt = new JwtService(p);
        UUID id = UUID.randomUUID();
        String t = jwt.accessToken(id, "STUDENT");
        assertEquals(id.toString(), jwt.parseAccess(t).getSubject());
        assertNull(jwt.parseAccess(t + "x"));
        // service tokens must NOT be accepted as user tokens (different key)
        assertNull(jwt.parseAccess(jwt.serviceToken(id, Map.of())));
    }
}
