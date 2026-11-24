"""Language-aware code parsing: symbols, imports and symbol-level chunks (Python via ast; Java/JS/TS via brace matching)."""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field

EXT_LANG = {
    ".py": "python", ".java": "java", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".go": "go", ".rs": "rust", ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
    ".cs": "csharp", ".kt": "kotlin", ".rb": "ruby", ".php": "php", ".swift": "swift", ".sql": "sql", ".sh": "bash",
    ".md": "markdown", ".yml": "yaml", ".yaml": "yaml", ".json": "json", ".xml": "xml", ".toml": "toml", ".gradle": "gradle",
    ".html": "html", ".css": "css", ".properties": "properties", ".txt": "text",
}
CONFIG_NAMES = {"pom.xml", "package.json", "build.gradle", "requirements.txt", "pyproject.toml", "dockerfile", "docker-compose.yml",
                "docker-compose.yaml", "application.yml", "application.properties", "application.yaml", "go.mod", "cargo.toml", "makefile"}


@dataclass
class Sym:
    name: str
    qualified: str
    kind: str  # CLASS | METHOD | FUNCTION
    start: int
    end: int
    signature: str


@dataclass
class CodeChunk:
    symbol: str | None
    kind: str
    start: int
    end: int
    text: str


@dataclass
class Parsed:
    symbols: list[Sym] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)
    chunks: list[CodeChunk] = field(default_factory=list)


def language_of(path: str) -> str | None:
    low = path.lower().rsplit("/", 1)[-1]
    if low in CONFIG_NAMES:
        return "config"
    i = low.rfind(".")
    return EXT_LANG.get(low[i:]) if i != -1 else None


def split_identifiers(text: str) -> str:
    """'getUserById user_id' -> 'getUserById get User By Id user_id user id' so lexical search matches sub-words."""
    out = []
    for ident in set(re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", text)):
        parts = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", ident).replace("_", " ").split()
        if len(parts) > 1:
            out.extend(p.lower() for p in parts)
    return text + "\n" + " ".join(out)


def _lines(src: str) -> list[str]:
    return src.split("\n")


def _slice(lines: list[str], s: int, e: int) -> str:
    return "\n".join(lines[s - 1:e])


def _window_chunks(lines: list[str], size: int = 60, overlap: int = 10) -> list[CodeChunk]:
    out = []
    i = 0
    while i < len(lines):
        j = min(len(lines), i + size)
        txt = "\n".join(lines[i:j])
        if txt.strip():
            out.append(CodeChunk(None, "MODULE", i + 1, j, txt))
        if j == len(lines):
            break
        i = j - overlap
    return out


# ---------------- Python ----------------
def parse_python(src: str) -> Parsed:
    lines = _lines(src)
    p = Parsed()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        p.chunks = _window_chunks(lines)
        return p
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            p.imports += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            p.imports.append(("." * node.level) + (node.module or ""))
    covered: list[tuple[int, int]] = []

    def sig_of(n) -> str:
        return lines[n.lineno - 1].strip()[:300]

    def add_func(n, prefix: str, kind: str, header: str = ""):
        start = (n.decorator_list[0].lineno if n.decorator_list else n.lineno)
        end = n.end_lineno or n.lineno
        q = f"{prefix}{n.name}"
        p.symbols.append(Sym(n.name, q, kind, start, end, sig_of(n)))
        body = _slice(lines, start, end)
        p.chunks.append(CodeChunk(q, kind, start, end, (header + "\n" if header else "") + body))
        covered.append((start, end))

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            add_func(node, "", "FUNCTION")
        elif isinstance(node, ast.ClassDef):
            start = node.decorator_list[0].lineno if node.decorator_list else node.lineno
            end = node.end_lineno or node.lineno
            p.symbols.append(Sym(node.name, node.name, "CLASS", start, end, sig_of(node)))
            if end - start + 1 <= 150:
                p.chunks.append(CodeChunk(node.name, "CLASS", start, end, _slice(lines, start, end)))
                for m in node.body:
                    if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        p.symbols.append(Sym(m.name, f"{node.name}.{m.name}", "METHOD", m.lineno, m.end_lineno or m.lineno, sig_of(m)))
            else:
                header = lines[node.lineno - 1].strip()
                for m in node.body:
                    if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        add_func(m, f"{node.name}.", "METHOD", f"# class {header}")
            covered.append((start, end))
    # module-level remainder (constants, scripts)
    rest = []
    for i, ln in enumerate(lines, 1):
        if not any(s <= i <= e for s, e in covered):
            rest.append((i, ln))
    if rest and any(l.strip() for _, l in rest):
        txt = "\n".join(l for _, l in rest).strip()
        if txt:
            p.chunks.append(CodeChunk(None, "MODULE", rest[0][0], rest[-1][0], txt[:6000]))
    return p


# ---------------- brace languages ----------------
_JAVA_TYPE = re.compile(r"^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|protected|private|abstract|final|static|sealed)?\s*(?:public|protected|private|abstract|final|static|sealed|\s)*(class|interface|enum|record)\s+(\w+)")
_JAVA_METHOD = re.compile(r"^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|protected|private|static|final|abstract|synchronized|default|\s)+[\w<>\[\],.? ]+\s+(\w+)\s*\([^;{]*\)\s*(?:throws [\w., ]+)?\s*\{?\s*$")
_JS_FUNC = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(")
_JS_ARROW = re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>")
_JS_CLASS = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)")
_JS_METHOD = re.compile(r"^\s{2,}(?:public|private|protected|static|async|get|set|readonly|\s)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$")
_TS_IFACE = re.compile(r"^\s*(?:export\s+)?(?:interface|type|enum)\s+(\w+)")
_KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "else", "do", "try", "synchronized", "new", "throw", "constructor_"}


def _find_block_end(lines: list[str], start_idx: int) -> int:
    """1-based end line of the brace block opened at/after start_idx (ignores braces in strings/comments heuristically)."""
    depth, opened = 0, False
    for i in range(start_idx, min(len(lines), start_idx + 2000)):
        ln = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`[^`]*`|//.*$', "", lines[i])
        for ch in ln:
            if ch == "{":
                depth += 1
                opened = True
            elif ch == "}":
                depth -= 1
                if opened and depth == 0:
                    return i + 1
        if not opened and i > start_idx + 3 and ln.strip().endswith(";"):
            return i + 1
    return min(len(lines), start_idx + 1)


def _attach_leading(lines: list[str], idx: int) -> int:
    """Include annotations/decorators/comments directly above a declaration."""
    j = idx
    while j > 0 and (lines[j - 1].strip().startswith(("@", "//", "*", "/*", "/**")) or lines[j - 1].strip().endswith("*/")):
        j -= 1
    return j


def parse_brace(src: str, lang: str) -> Parsed:
    lines = _lines(src)
    p = Parsed()
    java = lang == "java"
    for ln in lines:
        s = ln.strip()
        if java:
            m = re.match(r"import\s+(?:static\s+)?([\w.*]+);", s)
            if m:
                p.imports.append(m.group(1))
        else:
            m = re.match(r"import\s+(?:[\w*{}\s,$]+\s+from\s+)?['\"]([^'\"]+)['\"]", s) or re.search(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)", s) \
                or re.match(r"export\s+[\w*{}\s,]+\s+from\s+['\"]([^'\"]+)['\"]", s)
            if m:
                p.imports.append(m.group(1))
    covered: list[tuple[int, int]] = []
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        tm = _JAVA_TYPE.match(ln) if java else (_JS_CLASS.match(ln))
        kind_name = None
        if tm and not ln.strip().startswith(("//", "*")):
            name = tm.group(2) if java else tm.group(1)
            start = _attach_leading(lines, i) + 1
            end = _find_block_end(lines, i)
            p.symbols.append(Sym(name, name, "CLASS", start, end, ln.strip()[:300]))
            if end - start + 1 <= 150:
                p.chunks.append(CodeChunk(name, "CLASS", start, end, _slice(lines, start, end)))
                for sm in _methods_in(lines, i + 1, end, name, java, p, add_chunks=False):
                    pass
            else:
                header = ln.strip()
                _methods_in(lines, i + 1, end, name, java, p, add_chunks=True, header=header)
            covered.append((start, end))
            i = end
            continue
        if not java:
            fm = _JS_FUNC.match(ln) or _JS_ARROW.match(ln)
            if fm:
                name = fm.group(1)
                start = _attach_leading(lines, i) + 1
                end = _find_block_end(lines, i)
                p.symbols.append(Sym(name, name, "FUNCTION", start, end, ln.strip()[:300]))
                p.chunks.append(CodeChunk(name, "FUNCTION", start, end, _slice(lines, start, end)))
                covered.append((start, end))
                i = end
                continue
            im = _TS_IFACE.match(ln) if lang == "typescript" else None
            if im:
                name = im.group(1)
                end = _find_block_end(lines, i)
                p.symbols.append(Sym(name, name, "CLASS", i + 1, end, ln.strip()[:300]))
                p.chunks.append(CodeChunk(name, "CLASS", i + 1, end, _slice(lines, i + 1, end)))
                covered.append((i + 1, end))
                i = end
                continue
        i += 1
    rest = [(k, l) for k, l in enumerate(lines, 1) if not any(s <= k <= e for s, e in covered)]
    txt = "\n".join(l for _, l in rest).strip()
    if txt and len(txt) > 40:
        p.chunks.append(CodeChunk(None, "MODULE", rest[0][0], rest[-1][0], txt[:6000]))
    if not p.chunks:
        p.chunks = _window_chunks(lines)
    return p


def _methods_in(lines, from_idx, to_line, cls, java, p: Parsed, add_chunks: bool, header: str = ""):
    i = from_idx
    out = []
    pat = _JAVA_METHOD if java else _JS_METHOD
    while i < to_line - 1:
        ln = lines[i]
        m = pat.match(ln)
        if m and m.group(1) not in _KEYWORDS and not ln.strip().startswith(("return", "else", "new ", "throw")):
            name = m.group(1)
            start = _attach_leading(lines, i) + 1
            end = _find_block_end(lines, i)
            q = f"{cls}.{name}"
            p.symbols.append(Sym(name, q, "METHOD", start, end, ln.strip()[:300]))
            if add_chunks:
                p.chunks.append(CodeChunk(q, "METHOD", start, end, (f"// in {header}\n" if header else "") + _slice(lines, start, end)))
            out.append(name)
            i = end
            continue
        i += 1
    return out


def parse_file(path: str, lang: str, src: str) -> Parsed:
    if lang == "python":
        return parse_python(src)
    if lang in ("java", "javascript", "typescript"):
        return parse_brace(src, lang)
    lines = _lines(src)
    p = Parsed()
    if lang in ("markdown",):
        p.chunks = _markdown_chunks(lines)
    elif lang == "config":
        p.chunks = [CodeChunk(None, "CONFIG", 1, len(lines), src[:6000])]
    else:
        p.chunks = _window_chunks(lines)
    return p


def _markdown_chunks(lines: list[str]) -> list[CodeChunk]:
    out, start, buf = [], 1, []
    for i, ln in enumerate(lines, 1):
        if re.match(r"^#{1,3}\s", ln) and buf and sum(len(b) for b in buf) > 300:
            out.append(CodeChunk(None, "DOC", start, i - 1, "\n".join(buf)))
            start, buf = i, []
        buf.append(ln)
        if sum(len(b) for b in buf) > 2500:
            out.append(CodeChunk(None, "DOC", start, i, "\n".join(buf)))
            start, buf = i + 1, []
    if "\n".join(buf).strip():
        out.append(CodeChunk(None, "DOC", start, len(lines), "\n".join(buf)))
    return out


def resolve_import(imp: str, from_path: str, lang: str, all_paths: set[str], by_suffix: dict[str, str]) -> str | None:
    """Resolve an import to a repo file path, or None when external."""
    if lang in ("javascript", "typescript"):
        if not imp.startswith("."):
            return None
        base = "/".join(from_path.split("/")[:-1])
        parts = (base + "/" + imp).split("/") if base else imp.split("/")
        stack: list[str] = []
        for part in parts:
            if part in ("", "."):
                continue
            if part == "..":
                if stack:
                    stack.pop()
            else:
                stack.append(part)
        cand = "/".join(stack)
        for suffix in ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"):
            if cand + suffix in all_paths:
                return cand + suffix
        return None
    if lang == "python":
        dots = len(imp) - len(imp.lstrip("."))
        mod = imp.lstrip(".")
        if dots:
            base = from_path.split("/")[:-1]
            if dots > 1:
                base = base[: len(base) - (dots - 1)]
            rel = "/".join(base + ([mod.replace(".", "/")] if mod else []))
            for cand in (rel + ".py", rel + "/__init__.py"):
                if cand in all_paths:
                    return cand
            return None
        rel = mod.replace(".", "/")
        for key in (rel + ".py", rel + "/__init__.py"):
            if key in by_suffix:
                return by_suffix[key]
        return None
    if lang == "java":
        fq = imp.rstrip(".*").replace(".", "/")
        for key in (fq + ".java",):
            if key in by_suffix:
                return by_suffix[key]
        return None
    return None
