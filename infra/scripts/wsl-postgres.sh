#!/bin/bash
# Dev helper: start local Postgres (WSL) used when Docker Desktop is unavailable.
pg_ctlcluster 16 main start 2>&1 || true
sleep 3
su postgres -c "psql -tc \"select 1 from pg_roles where rolname='campusai'\"" | grep -q 1 || su postgres -c "psql -c \"CREATE ROLE campusai LOGIN SUPERUSER PASSWORD 'campusai'\""
su postgres -c "psql -tc \"select 1 from pg_database where datname='campusai'\"" | grep -q 1 || su postgres -c "createdb -O campusai campusai"
su postgres -c "psql -d campusai -c 'CREATE EXTENSION IF NOT EXISTS vector SCHEMA public' -c 'select extname, extversion from pg_extension'"
pg_lsclusters
