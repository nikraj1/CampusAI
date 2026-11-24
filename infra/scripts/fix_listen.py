import sys

p = "/etc/postgresql/16/main/postgresql.conf"
with open(p, "r") as f:
    text = f.read()

if "listen_addresses = '*'" not in text:
    text = text.replace("#listen_addresses = 'localhost'", "listen_addresses = '*'")
    with open(p, "w") as f:
        f.write(text)
    print("Updated listen_addresses to *")
else:
    print("Already updated")
