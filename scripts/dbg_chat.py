import sys, time, uuid, json
sys.path.insert(0, "scripts")
import httpx
import e2e_smoke as e

api = "http://localhost:8080/api/v1"
c = httpx.Client(timeout=120)
email = f"dbg-{uuid.uuid4().hex[:6]}@example.com"
H = {"Authorization": "Bearer " + c.post(api + "/auth/register", json={"email": email, "password": "Sup3r-secret-pw!", "fullName": "D"}).json()["accessToken"]}
r = c.post(api + "/documents", headers=H, files={"file": ("n.pdf", e.make_pdf(e.NOTES), "application/pdf")}, data={"title": "OS Notes"}).json()
while c.get(f"{api}/jobs/{r['jobId']}", headers=H).json()["status"] not in ("SUCCEEDED", "FAILED"):
    time.sleep(1)
conv = c.post(api + "/conversations", headers=H, json={"module": "STUDY", "scope": {"documentIds": [r["documentId"]]}}).json()
q = sys.argv[1] if len(sys.argv) > 1 else "What is the difference between paging and segmentation?"
name = None
text = ""
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
print("ANSWER:", text)
c.request("DELETE", api + "/users/me", headers=H, json={"password": "Sup3r-secret-pw!"})
