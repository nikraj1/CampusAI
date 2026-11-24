package com.campusai.study;

/** Pure scoring/mastery logic (unit tested). */
public final class MasteryCalculator {
    private MasteryCalculator() {}

    public static final double ALPHA = 0.3;

    public static double difficultyWeight(String difficulty) {
        return switch (difficulty == null ? "MEDIUM" : difficulty.toUpperCase()) {
            case "EASY" -> 0.8;
            case "HARD" -> 1.2;
            default -> 1.0;
        };
    }

    /** mastery <- mastery + alpha * w * (s - mastery), clamped to [0,1]. */
    public static double update(double mastery, double fractionCorrect, double weight) {
        double m = mastery + ALPHA * weight * (fractionCorrect - mastery);
        return Math.max(0.0, Math.min(1.0, m));
    }

    /** An answer is correct iff the selected set equals the correct set. */
    public static boolean isCorrect(java.util.Collection<Integer> selected, java.util.Collection<Integer> correct) {
        return new java.util.HashSet<>(selected).equals(new java.util.HashSet<>(correct));
    }
}
