-- Gelatos Lele — notificações de novos pedidos
-- Execute uma única vez no console D1 da Cloudflare.
-- Endpoints de push são credenciais do aparelho: não exporte nem compartilhe esta tabela.

CREATE TABLE IF NOT EXISTS gelatos_push_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  store_slug TEXT NOT NULL,
  member_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  UNIQUE (store_slug, endpoint),
  FOREIGN KEY (member_id) REFERENCES gelatos_team_members(member_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gelatos_push_subscriptions_store
  ON gelatos_push_subscriptions(store_slug, enabled);
