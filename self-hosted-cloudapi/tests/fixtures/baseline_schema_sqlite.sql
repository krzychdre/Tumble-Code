-- The pre-Alembic (LEGACY) schema of the cloud API, as SQLite DDL.
--
-- Generated once from the ORM models of the first commit that shipped this
-- directory (2912420e6, "Feature/self hosted cloud backend (#112)"), whose
-- migration chain ended at b2c3d4e5f6a7 (datetime_timezone). It stands in for
-- the no-op baseline a1b2c3d4e5f6, which records "the tables create_all built
-- before Alembic" but contains no DDL of its own.
--
-- On SQLite a1b2c3d4e5f6 and b2c3d4e5f6a7 are the same schema: DateTime() and
-- DateTime(timezone=True) are both DATETIME there, so the timezone migration
-- changes nothing SQLite can see (and cannot run on SQLite at all, see
-- tests/test_migration_drift.py).
--
-- Do not regenerate this file from the current models: it is a frozen
-- snapshot, and the drift check is only meaningful because it is.

CREATE TABLE authentik_state_store (
	state VARCHAR NOT NULL, 
	auth_redirect VARCHAR NOT NULL, 
	code_verifier VARCHAR NOT NULL, 
	created_at DATETIME, 
	expires_at DATETIME NOT NULL, 
	PRIMARY KEY (state)
);

CREATE TABLE client_tokens (
	id VARCHAR NOT NULL, 
	session_id VARCHAR NOT NULL, 
	token_hash VARCHAR NOT NULL, 
	created_at DATETIME, 
	expires_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE TABLE memberships (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	organization_id VARCHAR NOT NULL, 
	role VARCHAR, 
	permissions TEXT, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE TABLE organization_settings (
	id VARCHAR NOT NULL, 
	organization_id VARCHAR NOT NULL, 
	version INTEGER, 
	record_task_messages BOOLEAN, 
	enable_task_sharing BOOLEAN, 
	allow_public_task_sharing BOOLEAN, 
	task_share_expiration_days INTEGER, 
	allow_members_view_all_tasks BOOLEAN, 
	workspace_task_visibility VARCHAR, 
	llm_enhanced_features_enabled BOOLEAN, 
	default_settings TEXT, 
	allow_list TEXT, 
	features TEXT, 
	hidden_mcps TEXT, 
	hide_marketplace_mcps BOOLEAN, 
	mcps TEXT, 
	provider_profiles TEXT, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (organization_id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE TABLE organizations (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	slug VARCHAR, 
	image_url VARCHAR, 
	has_image BOOLEAN, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (slug)
);

CREATE TABLE provider_configs (
	id VARCHAR NOT NULL, 
	organization_id VARCHAR, 
	providers TEXT NOT NULL, 
	model_overrides TEXT, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (organization_id), 
	FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE TABLE sessions (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	created_at DATETIME, 
	expires_at DATETIME, 
	is_active BOOLEAN, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE task_messages (
	id VARCHAR NOT NULL, 
	task_id VARCHAR NOT NULL, 
	message_data TEXT NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES tasks (id) ON DELETE CASCADE
);

CREATE TABLE task_shares (
	id VARCHAR NOT NULL, 
	task_id VARCHAR NOT NULL, 
	visibility VARCHAR, 
	share_url VARCHAR, 
	manage_url VARCHAR, 
	expires_at DATETIME, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES tasks (id) ON DELETE CASCADE
);

CREATE TABLE tasks (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	organization_id VARCHAR, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE SET NULL
);

CREATE TABLE telemetry_events (
	id VARCHAR NOT NULL, 
	user_id VARCHAR, 
	organization_id VARCHAR, 
	event_type VARCHAR NOT NULL, 
	properties TEXT, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(organization_id) REFERENCES organizations (id) ON DELETE SET NULL
);

CREATE TABLE tickets (
	code VARCHAR NOT NULL, 
	session_id VARCHAR NOT NULL, 
	created_at DATETIME, 
	expires_at DATETIME NOT NULL, 
	used BOOLEAN, 
	PRIMARY KEY (code), 
	FOREIGN KEY(session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE TABLE user_settings (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	features TEXT, 
	settings TEXT, 
	version INTEGER, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE users (
	id VARCHAR NOT NULL, 
	authentik_id VARCHAR NOT NULL, 
	email VARCHAR NOT NULL, 
	first_name VARCHAR, 
	last_name VARCHAR, 
	image_url VARCHAR, 
	public_metadata TEXT, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_client_tokens_session_id ON client_tokens (session_id);

CREATE UNIQUE INDEX ix_client_tokens_token_hash ON client_tokens (token_hash);

CREATE INDEX ix_memberships_organization_id ON memberships (organization_id);

CREATE INDEX ix_memberships_user_id ON memberships (user_id);

CREATE INDEX ix_sessions_user_id ON sessions (user_id);

CREATE INDEX ix_task_messages_task_id ON task_messages (task_id);

CREATE INDEX ix_task_shares_task_id ON task_shares (task_id);

CREATE INDEX ix_tasks_user_id ON tasks (user_id);

CREATE INDEX ix_telemetry_events_event_type ON telemetry_events (event_type);

CREATE INDEX ix_telemetry_events_organization_id ON telemetry_events (organization_id);

CREATE INDEX ix_telemetry_events_user_id ON telemetry_events (user_id);

CREATE INDEX ix_tickets_session_id ON tickets (session_id);

CREATE UNIQUE INDEX ix_users_authentik_id ON users (authentik_id);

CREATE INDEX ix_users_email ON users (email);

