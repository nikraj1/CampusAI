import os, sys
sys.path.insert(0, "services/ai")
from campusai_ai import config  # loads .env into os.environ
import httpx
r = httpx.get("https://api.groq.com/openai/v1/models", headers={"Authorization": "Bearer " + os.environ["GROQ_API_KEY"]}, timeout=20)
print(r.status_code)
for m in sorted(x["id"] for x in r.json().get("data", [])):
    print(m)
