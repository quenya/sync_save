-- Week 3 draft schema: save revision metadata and conflict context.
CREATE TABLE IF NOT EXISTS save_revisions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  checksum VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_save_revisions_game_id ON save_revisions(game_id);
CREATE INDEX IF NOT EXISTS idx_save_revisions_user_id ON save_revisions(user_id);
