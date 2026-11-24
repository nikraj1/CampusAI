package com.campusai.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.postgresql.util.PGobject;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.Array;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.*;

/**
 * Thin JDBC helper. Rows come back as camelCase maps with jsonb parsed to JSON and arrays to lists,
 * so controllers can return them directly.
 */
@Component
public class Db {
    private final JdbcClient jdbc;
    private final ObjectMapper om;

    public Db(JdbcClient jdbc, ObjectMapper om) {
        this.jdbc = jdbc;
        this.om = om;
    }

    public ObjectMapper mapper() { return om; }

    public List<Map<String, Object>> list(String sql, Object... params) {
        List<Map<String, Object>> raw = jdbc.sql(sql).params(Arrays.asList(params)).query().listOfRows();
        List<Map<String, Object>> out = new ArrayList<>(raw.size());
        for (Map<String, Object> r : raw) out.add(convert(r));
        return out;
    }

    public Optional<Map<String, Object>> one(String sql, Object... params) {
        List<Map<String, Object>> l = list(sql, params);
        return l.isEmpty() ? Optional.empty() : Optional.of(l.get(0));
    }

    public Map<String, Object> require(String what, String sql, Object... params) {
        return one(sql, params).orElseThrow(() -> ApiException.notFound(what));
    }

    public int update(String sql, Object... params) {
        return jdbc.sql(sql).params(Arrays.asList(params)).update();
    }

    public <T> T scalar(String sql, Class<T> type, Object... params) {
        return jdbc.sql(sql).params(Arrays.asList(params)).query(type).optional().orElse(null);
    }

    public String json(Object o) {
        try {
            return om.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public JsonNode parse(String s) {
        try {
            return s == null ? null : om.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String camel(String s) {
        StringBuilder b = new StringBuilder();
        boolean up = false;
        for (char c : s.toCharArray()) {
            if (c == '_') { up = true; continue; }
            b.append(up ? Character.toUpperCase(c) : c);
            up = false;
        }
        return b.toString();
    }

    private Map<String, Object> convert(Map<String, Object> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : raw.entrySet()) {
            out.put(camel(e.getKey()), value(e.getValue()));
        }
        return out;
    }

    private Object value(Object v) {
        try {
            if (v instanceof PGobject p) {
                String t = p.getType();
                if ("json".equals(t) || "jsonb".equals(t)) return p.getValue() == null ? null : om.readTree(p.getValue());
                return p.getValue();
            }
            if (v instanceof Array a) {
                Object arr = a.getArray();
                List<Object> l = new ArrayList<>();
                if (arr instanceof Object[] objs) for (Object o : objs) l.add(value(o));
                return l;
            }
            if (v instanceof Timestamp t) return t.toInstant();
            if (v instanceof java.sql.Date d) return d.toLocalDate();
            if (v instanceof Short s) return s.intValue();
            return v;
        } catch (SQLException | com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
