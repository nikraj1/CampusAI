import sys, time, uuid, json
import httpx

api = "http://localhost:8080/api/v1"
c = httpx.Client(timeout=180)
email = f"dbg-{uuid.uuid4().hex[:6]}@example.com"
pw = "Sup3r-secret-pw!"
H = {"Authorization": "Bearer " + c.post(api + "/auth/register", json={"email": email, "password": pw, "fullName": "D"}).json()["accessToken"]}
r = c.post(api + "/projects/repositories", headers=H, json={"url": "https://github.com/spring-guides/gs-rest-service"}).json()
while c.get(f"{api}/jobs/{r['jobId']}", headers=H).json()["status"] not in ("SUCCEEDED", "FAILED"):
    time.sleep(2)
conv = c.post(api + "/conversations", headers=H, json={"module": "PROJECT", "scope": {"repositoryId": r["repositoryId"]}}).json()
q = sys.argv[1] if len(sys.argv) > 1 else "Where is the main entry point of this application and what does it do?"
name, text, run = None, "", None
with c.stream("POST", f"{api}/conversations/{conv['id']}/messages", headers=H, json={"content": q}) as resp:
    for line in resp.iter_lines():
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            d = line[5:].strip()
            if name == "token":
                text += json.loads(d)["t"]
            else:
                print(name, d[:300])
                if name == "run_started":
                    run = json.loads(d)["runId"]
print("ANSWER:", text[:1200])
tr = c.get(f"{api}/agent-runs/{run}", headers=H).json()
for s in tr["steps"]:
    print(s["stepIndex"], s["node"], s["status"], str(s["outputPreview"])[:500])
c.request("DELETE", api + "/users/me", headers=H, json={"password": pw})
