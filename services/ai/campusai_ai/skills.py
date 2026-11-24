"""Curated skills taxonomy with aliases, categories and free learning resources.

Resources here are the ONLY source of recommended URLs (the LLM never invents links, blueprint 11.6).
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Skill:
    name: str
    category: str
    aliases: tuple[str, ...] = ()


def _s(name: str, cat: str, *aliases: str) -> Skill:
    return Skill(name, cat, tuple(aliases))


SKILLS: list[Skill] = [
    _s("Java", "LANGUAGE", "core java", "java 8", "java 11", "java 17", "java 21"),
    _s("Python", "LANGUAGE", "python3", "python 3"),
    _s("JavaScript", "LANGUAGE", "js", "ecmascript", "es6", "es2015"),
    _s("TypeScript", "LANGUAGE", "ts"),
    _s("C", "LANGUAGE", "c programming"),
    _s("C++", "LANGUAGE", "cpp", "c plus plus"),
    _s("C#", "LANGUAGE", "csharp", "c sharp"),
    _s("Go", "LANGUAGE", "golang"),
    _s("Rust", "LANGUAGE"),
    _s("Kotlin", "LANGUAGE"),
    _s("Swift", "LANGUAGE"),
    _s("PHP", "LANGUAGE"),
    _s("Ruby", "LANGUAGE"),
    _s("SQL", "LANGUAGE", "structured query language"),
    _s("HTML", "LANGUAGE", "html5"),
    _s("CSS", "LANGUAGE", "css3"),
    _s("Bash", "LANGUAGE", "shell scripting", "shell"),
    _s("React", "FRAMEWORK", "reactjs", "react.js", "react js"),
    _s("Angular", "FRAMEWORK", "angularjs"),
    _s("Vue.js", "FRAMEWORK", "vue", "vuejs"),
    _s("Next.js", "FRAMEWORK", "nextjs", "next js"),
    _s("Node.js", "FRAMEWORK", "node", "nodejs", "node js"),
    _s("Express.js", "FRAMEWORK", "express", "expressjs"),
    _s("Spring Boot", "FRAMEWORK", "springboot", "spring-boot"),
    _s("Spring", "FRAMEWORK", "spring framework", "spring mvc", "spring security"),
    _s("Hibernate", "FRAMEWORK", "jpa", "spring data jpa"),
    _s("Django", "FRAMEWORK"),
    _s("Flask", "FRAMEWORK"),
    _s("FastAPI", "FRAMEWORK"),
    _s("Tailwind CSS", "FRAMEWORK", "tailwind", "tailwindcss"),
    _s("Bootstrap", "FRAMEWORK"),
    _s("Redux", "FRAMEWORK"),
    _s(".NET", "FRAMEWORK", "dotnet", "asp.net"),
    _s("Flutter", "FRAMEWORK"),
    _s("Android", "FRAMEWORK", "android development", "android sdk"),
    _s("PostgreSQL", "DATABASE", "postgres", "psql"),
    _s("MySQL", "DATABASE"),
    _s("MongoDB", "DATABASE", "mongo"),
    _s("Redis", "DATABASE"),
    _s("SQLite", "DATABASE"),
    _s("Oracle", "DATABASE", "oracle db", "pl/sql"),
    _s("Firebase", "DATABASE"),
    _s("Elasticsearch", "DATABASE", "elastic search"),
    _s("Docker", "TOOL", "containers", "containerization", "dockerfile", "docker compose"),
    _s("Kubernetes", "TOOL", "k8s"),
    _s("Git", "TOOL", "version control", "github", "gitlab"),
    _s("Linux", "TOOL", "ubuntu", "unix"),
    _s("AWS", "TOOL", "amazon web services", "ec2", "s3"),
    _s("Azure", "TOOL", "microsoft azure"),
    _s("GCP", "TOOL", "google cloud", "google cloud platform"),
    _s("CI/CD", "TOOL", "continuous integration", "github actions", "jenkins", "gitlab ci"),
    _s("Maven", "TOOL"),
    _s("Gradle", "TOOL"),
    _s("Postman", "TOOL"),
    _s("Kafka", "TOOL", "apache kafka"),
    _s("RabbitMQ", "TOOL"),
    _s("Nginx", "TOOL"),
    _s("Terraform", "TOOL"),
    _s("JUnit", "TOOL", "mockito", "unit testing"),
    _s("REST APIs", "CS_FUNDAMENTAL", "rest", "restful", "rest api", "restful apis", "api design"),
    _s("GraphQL", "CS_FUNDAMENTAL"),
    _s("Microservices", "CS_FUNDAMENTAL", "microservice architecture"),
    _s("System Design", "CS_FUNDAMENTAL", "high level design", "low level design", "hld", "lld", "scalability"),
    _s("Data Structures", "CS_FUNDAMENTAL", "dsa", "data structures and algorithms", "data structure"),
    _s("Algorithms", "CS_FUNDAMENTAL", "algorithm design", "competitive programming"),
    _s("Dynamic Programming", "CS_FUNDAMENTAL", "dp"),
    _s("Object-Oriented Programming", "CS_FUNDAMENTAL", "oop", "oops", "object oriented", "object-oriented design"),
    _s("Design Patterns", "CS_FUNDAMENTAL", "solid principles", "gang of four"),
    _s("Operating Systems", "CS_FUNDAMENTAL", "os concepts", "process scheduling", "operating system"),
    _s("Computer Networks", "CS_FUNDAMENTAL", "networking", "tcp/ip", "tcp ip", "computer networking"),
    _s("DBMS", "CS_FUNDAMENTAL", "database management", "database design", "normalization", "database management systems"),
    _s("Concurrency", "CS_FUNDAMENTAL", "multithreading", "multi-threading", "parallel programming"),
    _s("Authentication", "CS_FUNDAMENTAL", "jwt", "oauth", "oauth2", "authorization"),
    _s("Machine Learning", "AI_ML", "ml", "supervised learning", "scikit-learn", "sklearn"),
    _s("Deep Learning", "AI_ML", "neural networks", "cnn", "rnn"),
    _s("TensorFlow", "AI_ML"),
    _s("PyTorch", "AI_ML"),
    _s("NLP", "AI_ML", "natural language processing"),
    _s("LLMs", "AI_ML", "large language models", "generative ai", "genai", "prompt engineering", "rag", "langchain"),
    _s("Pandas", "AI_ML", "numpy", "data analysis"),
    _s("Data Science", "AI_ML", "data analytics", "data visualization"),
    _s("Computer Vision", "AI_ML", "opencv", "image processing"),
    _s("Agile", "PROCESS", "scrum", "kanban", "sprint"),
    _s("Testing", "PROCESS", "test driven development", "tdd", "integration testing", "selenium", "pytest", "jest"),
    _s("Communication", "SOFT", "communication skills", "presentation"),
    _s("Teamwork", "SOFT", "collaboration", "team player"),
    _s("Problem Solving", "SOFT", "analytical skills", "analytical thinking", "problem-solving"),
    _s("Leadership", "SOFT", "team lead"),
]

# Curated free resources, keyed by canonical skill name. Generic fallback per category below.
RESOURCES: dict[str, list[dict]] = {
    "Java": [{"title": "Dev.java - Learn Java", "url": "https://dev.java/learn/", "type": "COURSE"}],
    "Python": [{"title": "The Python Tutorial", "url": "https://docs.python.org/3/tutorial/", "type": "DOCS"}],
    "JavaScript": [{"title": "javascript.info", "url": "https://javascript.info/", "type": "COURSE"}],
    "TypeScript": [{"title": "TypeScript Handbook", "url": "https://www.typescriptlang.org/docs/handbook/intro.html", "type": "DOCS"}],
    "SQL": [{"title": "SQLBolt interactive lessons", "url": "https://sqlbolt.com/", "type": "PRACTICE"}],
    "React": [{"title": "React - Learn", "url": "https://react.dev/learn", "type": "DOCS"}],
    "Spring Boot": [{"title": "Spring Boot reference", "url": "https://docs.spring.io/spring-boot/index.html", "type": "DOCS"}],
    "Spring": [{"title": "Spring guides", "url": "https://spring.io/guides", "type": "COURSE"}],
    "Docker": [{"title": "Docker Get Started", "url": "https://docs.docker.com/get-started/", "type": "DOCS"}],
    "Kubernetes": [{"title": "Kubernetes Basics", "url": "https://kubernetes.io/docs/tutorials/kubernetes-basics/", "type": "COURSE"}],
    "Git": [{"title": "Pro Git book", "url": "https://git-scm.com/book/en/v2", "type": "BOOK"}],
    "Linux": [{"title": "Linux Journey", "url": "https://linuxjourney.com/", "type": "COURSE"}],
    "PostgreSQL": [{"title": "PostgreSQL Tutorial", "url": "https://www.postgresqltutorial.com/", "type": "COURSE"}],
    "MongoDB": [{"title": "MongoDB University", "url": "https://learn.mongodb.com/", "type": "COURSE"}],
    "REST APIs": [{"title": "RESTful API design guide", "url": "https://restfulapi.net/", "type": "ARTICLE"}],
    "System Design": [{"title": "System Design Primer", "url": "https://github.com/donnemartin/system-design-primer", "type": "REPO"}],
    "Data Structures": [{"title": "VisuAlgo - visualising data structures", "url": "https://visualgo.net/", "type": "PRACTICE"}],
    "Algorithms": [{"title": "NeetCode roadmap", "url": "https://neetcode.io/roadmap", "type": "PRACTICE"}],
    "Dynamic Programming": [{"title": "NeetCode: DP problems", "url": "https://neetcode.io/roadmap", "type": "PRACTICE"}],
    "Object-Oriented Programming": [{"title": "Refactoring Guru - OOP & patterns", "url": "https://refactoring.guru/design-patterns", "type": "ARTICLE"}],
    "Design Patterns": [{"title": "Refactoring Guru - Design Patterns", "url": "https://refactoring.guru/design-patterns", "type": "ARTICLE"}],
    "Operating Systems": [{"title": "OSTEP free book", "url": "https://pages.cs.wisc.edu/~remzi/OSTEP/", "type": "BOOK"}],
    "Computer Networks": [{"title": "Computer Networking: A Top-Down Approach (companion site)", "url": "https://gaia.cs.umass.edu/kurose_ross/", "type": "BOOK"}],
    "DBMS": [{"title": "CMU Intro to Database Systems", "url": "https://15445.courses.cs.cmu.edu/", "type": "COURSE"}],
    "Machine Learning": [{"title": "scikit-learn user guide", "url": "https://scikit-learn.org/stable/user_guide.html", "type": "DOCS"}],
    "Deep Learning": [{"title": "Dive into Deep Learning", "url": "https://d2l.ai/", "type": "BOOK"}],
    "AWS": [{"title": "AWS Skill Builder (free tier)", "url": "https://explore.skillbuilder.aws/learn", "type": "COURSE"}],
    "CI/CD": [{"title": "GitHub Actions docs", "url": "https://docs.github.com/en/actions", "type": "DOCS"}],
    "Microservices": [{"title": "microservices.io patterns", "url": "https://microservices.io/patterns/index.html", "type": "ARTICLE"}],
    "Testing": [{"title": "Testing JavaScript / general testing guide", "url": "https://martinfowler.com/testing/", "type": "ARTICLE"}],
    "Authentication": [{"title": "OWASP Authentication Cheat Sheet", "url": "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html", "type": "ARTICLE"}],
}
CATEGORY_RESOURCES: dict[str, list[dict]] = {
    "LANGUAGE": [{"title": "Exercism language tracks", "url": "https://exercism.org/tracks", "type": "PRACTICE"}],
    "FRAMEWORK": [{"title": "roadmap.sh - developer roadmaps", "url": "https://roadmap.sh/", "type": "ARTICLE"}],
    "DATABASE": [{"title": "Use The Index, Luke", "url": "https://use-the-index-luke.com/", "type": "BOOK"}],
    "TOOL": [{"title": "roadmap.sh - DevOps roadmap", "url": "https://roadmap.sh/devops", "type": "ARTICLE"}],
    "CS_FUNDAMENTAL": [{"title": "Teach Yourself CS", "url": "https://teachyourselfcs.com/", "type": "ARTICLE"}],
    "AI_ML": [{"title": "Hugging Face Learn", "url": "https://huggingface.co/learn", "type": "COURSE"}],
    "PROCESS": [{"title": "Atlassian Agile coach", "url": "https://www.atlassian.com/agile", "type": "ARTICLE"}],
    "SOFT": [{"title": "Harvard: communication skills overview", "url": "https://professional.dce.harvard.edu/blog/", "type": "ARTICLE"}],
}

BY_NAME: dict[str, Skill] = {s.name.lower(): s for s in SKILLS}


def resources_for(skill_name: str) -> list[dict]:
    r = RESOURCES.get(skill_name)
    if r:
        return r
    s = BY_NAME.get(skill_name.lower())
    return CATEGORY_RESOURCES.get(s.category, []) if s else []


def _pattern(term: str) -> re.Pattern:
    esc = re.escape(term.lower())
    # custom boundaries so that c++, c#, .net, node.js, ci/cd work
    return re.compile(r"(?<![a-z0-9+#.])" + esc + r"(?![a-z0-9+#]|\.[a-z0-9])", re.IGNORECASE)


_PATTERNS: list[tuple[Skill, re.Pattern]] = []
for _sk in SKILLS:
    for _term in {_sk.name.lower(), *_sk.aliases}:
        _PATTERNS.append((_sk, _pattern(_term)))
# very short ambiguous tokens only match in uppercase / specific contexts
_STRICT = {"C": re.compile(r"(?<![A-Za-z0-9+#.])C(?![A-Za-z0-9+#])(?!\s*[a-z])"), "Go": re.compile(r"(?<![A-Za-z0-9])(?:Go|Golang)(?![a-z0-9])"),
           "Spring": re.compile(r"(?<![A-Za-z0-9])Spring(?![a-z])"), "Oracle": re.compile(r"(?<![A-Za-z0-9])Oracle(?![a-z])")}


def extract_skills(text: str) -> list[Skill]:
    """Deterministic taxonomy matching; returns canonical skills in first-seen order."""
    found: dict[str, tuple[int, Skill]] = {}
    for sk, pat in _PATTERNS:
        if sk.name in _STRICT:
            continue
        m = pat.search(text)
        if m and (sk.name not in found or m.start() < found[sk.name][0]):
            found[sk.name] = (m.start(), sk)
    for name, pat in _STRICT.items():
        m = pat.search(text)
        if m:
            found[name] = (m.start(), BY_NAME[name.lower()])
    return [v[1] for v in sorted(found.values(), key=lambda x: x[0])]


def normalize(skill: str) -> Skill | None:
    """Map a free-form skill string to a canonical skill, if known."""
    t = skill.strip().lower()
    if t in BY_NAME:
        return BY_NAME[t]
    for sk in SKILLS:
        if t in sk.aliases:
            return sk
    hits = extract_skills(skill)
    return hits[0] if len(hits) == 1 else None
