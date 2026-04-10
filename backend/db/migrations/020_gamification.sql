-- GoFuvar Gamifikáció: szintek, jelvények, jutalékmentes voucher-ek.

-- ============ SZINTEK (a user táblán tároljuk) ============
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS level            INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS level_name       TEXT NOT NULL DEFAULT 'Kezdő',
    ADD COLUMN IF NOT EXISTS total_deliveries INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_earnings   INTEGER NOT NULL DEFAULT 0;

-- ============ JELVÉNYEK ============
CREATE TABLE IF NOT EXISTS user_badges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id    TEXT NOT NULL,          -- 'first_delivery', 'lightning', 'eu_driver', stb.
    badge_name  TEXT NOT NULL,          -- 'Első fuvar', 'Villámgyors', stb.
    badge_icon  TEXT NOT NULL,          -- '🏁', '⚡', '🌍', stb.
    earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges(user_id);

-- ============ JUTALÉKMENTES VOUCHER-EK ============
-- A sofőr adott szinttől havonta X db jutalékmentes fuvart kap.
-- Amikor használja, a platform 0% jutalékot von le (100% a sofőré).
CREATE TABLE IF NOT EXISTS fee_vouchers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Mire használható
    reason      TEXT NOT NULL,          -- 'level_monthly', 'level_up_bonus', 'promo'
    -- Mikor jár le
    valid_from  DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE NOT NULL,
    -- Felhasználás
    used_at     TIMESTAMPTZ,
    used_on_job UUID REFERENCES jobs(id) ON DELETE SET NULL,
    used_on_booking UUID REFERENCES route_bookings(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_user    ON fee_vouchers(user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_unused  ON fee_vouchers(user_id, used_at) WHERE used_at IS NULL;

-- ============ HETI KIHÍVÁSOK ============
CREATE TABLE IF NOT EXISTS weekly_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start      DATE NOT NULL,
    challenge_type  TEXT NOT NULL,       -- 'deliveries', 'rating', 'bids'
    challenge_title TEXT NOT NULL,       -- 'Teljesíts 3 fuvart e héten'
    target_value    INTEGER NOT NULL,    -- 3
    current_value   INTEGER NOT NULL DEFAULT 0,
    reward_type     TEXT NOT NULL,       -- 'voucher', 'badge', 'bonus_huf'
    reward_value    TEXT,                -- 'fee_voucher_1' vagy '500'
    completed       BOOLEAN NOT NULL DEFAULT false,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, week_start, challenge_type)
);
CREATE INDEX IF NOT EXISTS idx_challenges_user ON weekly_challenges(user_id, week_start);
