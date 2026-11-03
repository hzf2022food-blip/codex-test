BEGIN;
CREATE TABLE IF NOT EXISTS opc_workspaces (
 id uuid PRIMARY KEY,owner_subject text NOT NULL UNIQUE,name text NOT NULL DEFAULT '我的一人公司',
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),supply_revision bigint NOT NULL DEFAULT 0 CHECK(supply_revision>=0),
 operations_revision bigint NOT NULL DEFAULT 0 CHECK(operations_revision>=0),schema_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS opc_entities (
 workspace_id uuid NOT NULL REFERENCES opc_workspaces(id),entity_type text NOT NULL,entity_id text NOT NULL,
 business_id text CHECK(business_id IS NULL OR business_id IN ('BUS-001','BUS-002','BUS-003','BUS-004')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),row_revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS opc_entities_business ON opc_entities(workspace_id,business_id,entity_type);
CREATE TABLE IF NOT EXISTS opc_requests (
 workspace_id uuid NOT NULL REFERENCES opc_workspaces(id),request_id text NOT NULL,request_hash text NOT NULL,
 actor_subject text NOT NULL,response_payload jsonb NOT NULL,workspace_revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,request_id)
);
CREATE TABLE IF NOT EXISTS opc_audit (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES opc_workspaces(id),actor_subject text NOT NULL,request_id text NOT NULL,
 action text NOT NULL,entity_type text,entity_id text,before_payload jsonb,after_payload jsonb,workspace_revision bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS opc_sessions (
 token_hash text PRIMARY KEY,user_subject text NOT NULL,credential_version text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opc_sessions_expiry ON opc_sessions(expires_at);
ALTER TABLE opc_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE opc_workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE opc_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opc_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE opc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE opc_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE opc_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE opc_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opc_workspace_owner ON opc_workspaces;
CREATE POLICY opc_workspace_owner ON opc_workspaces
 USING(owner_subject=current_setting('app.user_sub',true)) WITH CHECK(owner_subject=current_setting('app.user_sub',true));

DROP POLICY IF EXISTS opc_entity_owner ON opc_entities;
CREATE POLICY opc_entity_owner ON opc_entities USING(EXISTS(SELECT 1 FROM opc_workspaces w WHERE w.id=workspace_id AND w.owner_subject=current_setting('app.user_sub',true))) WITH CHECK(EXISTS(SELECT 1 FROM opc_workspaces w WHERE w.id=workspace_id AND w.owner_subject=current_setting('app.user_sub',true)));

DROP POLICY IF EXISTS opc_request_owner ON opc_requests;
CREATE POLICY opc_request_owner ON opc_requests USING(EXISTS(SELECT 1 FROM opc_workspaces w WHERE w.id=workspace_id AND w.owner_subject=current_setting('app.user_sub',true))) WITH CHECK(EXISTS(SELECT 1 FROM opc_workspaces w WHERE w.id=workspace_id AND w.owner_subject=current_setting('app.user_sub',true)));

DROP POLICY IF EXISTS opc_audit_owner ON opc_audit;
CREATE POLICY opc_audit_owner ON opc_audit USING(EXISTS(SELECT 1 FROM opc_workspaces w WHERE w.id=workspace_id AND w.owner_subject=current_setting('app.user_sub',true))) WITH CHECK(EXISTS(SELECT 1 FROM opc_workspaces w WHERE w.id=workspace_id AND w.owner_subject=current_setting('app.user_sub',true)));

COMMIT;
