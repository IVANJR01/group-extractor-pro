#!/usr/bin/env bash
# Recria o banco local de testes: shim do Supabase + todas as migrations.
set -euo pipefail
DB_URL="${TEST_DATABASE_URL:-postgres://gep:gep@localhost/gep_test}"
ADMIN_URL="${DB_URL%/*}/postgres"
DB_NAME="${DB_URL##*/}"
psql "$ADMIN_URL" -qc "drop database if exists $DB_NAME" -c "create database $DB_NAME"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DB_URL" -qc "grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;"
echo "Banco de testes pronto: $DB_URL"
