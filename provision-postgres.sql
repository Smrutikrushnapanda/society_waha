\set ON_ERROR_STOP on
\if :{?waha_role}
\else
  \set waha_role waha_runtime
\endif
\if :{?waha_session}
\else
  \set waha_session session_01m5amp8ak239hr4cs57ydvaqm
\endif

SELECT :'waha_role' ~ '^[a-z][a-z0-9_]{2,50}$'
   AND :'waha_session' ~ '^[-A-Za-z0-9_]+$'
   AND length('waha_webjs_' || lower(:'waha_session')) <= 63 AS valid_names \gset
\if :valid_names
\else
  \echo 'Invalid WAHA role or session name; no changes made.'
  \quit 1
\endif

SELECT 'waha_all' AS main_db,
       'waha_webjs_' || regexp_replace(lower(:'waha_session'), '[^a-z0-9-]', '_', 'g') AS session_db \gset

SELECT NOT EXISTS (
  SELECT FROM pg_database
  WHERE datname IN (:'main_db', :'session_db')
    AND pg_get_userbyid(datdba) <> :'waha_role'
) AS ownership_safe \gset
\if :ownership_safe
\else
  \echo 'An existing WAHA database has another owner; review before provisioning.'
  \quit 1
\endif

SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = :'waha_role') AS role_exists \gset
\if :role_exists
  SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls AND rolcanlogin
    AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = pg_roles.oid)
    AS role_safe FROM pg_roles WHERE rolname = :'waha_role' \gset
  \if :role_safe
  \else
    \echo 'Existing role is not a dedicated least-privilege WAHA login; review manually.'
    \quit 1
  \endif
\else
  CREATE ROLE :"waha_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  \password :waha_role
\endif

SELECT format('CREATE DATABASE %I OWNER %I', :'main_db', :'waha_role')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'main_db') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'session_db', :'waha_role')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'session_db') \gexec

GRANT CONNECT ON DATABASE postgres TO :"waha_role";
REVOKE ALL ON DATABASE :"main_db" FROM PUBLIC;
REVOKE ALL ON DATABASE :"session_db" FROM PUBLIC;

\echo 'WAHA databases provisioned. Save role password in secret management, not SQL files.'
\echo 'Role owns only WAHA databases and cannot create arbitrary new databases.'
\echo 'Provision each additional session database before creating that session through WAHA.'
