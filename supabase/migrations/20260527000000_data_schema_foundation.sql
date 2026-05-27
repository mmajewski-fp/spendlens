-- ============================================================
-- SpendLens — Data Schema Foundation
-- Migration: 20260527000000
-- Tables: categories, transactions, savings_goals
-- All monetary amounts stored as integer (cents).
-- ============================================================

-- -------------------------
-- 1. categories
-- -------------------------

CREATE TABLE categories (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- anon users can read the category list (future public surfaces)
CREATE POLICY categories_anon_select
  ON categories FOR SELECT
  TO anon
  USING (true);

-- authenticated users can also read
CREATE POLICY categories_authenticated_select
  ON categories FOR SELECT
  TO authenticated
  USING (true);

-- Seed the fixed taxonomy (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO categories (name, slug) VALUES
  ('Groceries',       'groceries'),
  ('Dining',          'dining'),
  ('Transport',       'transport'),
  ('Housing',         'housing'),
  ('Utilities',       'utilities'),
  ('Entertainment',   'entertainment'),
  ('Healthcare',      'healthcare'),
  ('Shopping',        'shopping'),
  ('Travel',          'travel'),
  ('Salary',          'salary'),
  ('Other',           'other')
ON CONFLICT (slug) DO NOTHING;

-- -------------------------
-- 2. transactions
-- -------------------------

CREATE TABLE transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid        REFERENCES categories(id),
  amount      integer     NOT NULL,         -- cents; always positive
  type        text        NOT NULL CHECK (type IN ('income', 'expense')),
  description text,
  date        date        NOT NULL,
  external_id text,                         -- idempotency key for simulated API import
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_authenticated_select
  ON transactions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY transactions_authenticated_insert
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY transactions_authenticated_update
  ON transactions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY transactions_authenticated_delete
  ON transactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- -------------------------
-- 3. savings_goals
-- -------------------------

CREATE TABLE savings_goals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  target_amount integer     NOT NULL,       -- cents
  target_date   date        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY savings_goals_authenticated_select
  ON savings_goals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY savings_goals_authenticated_insert
  ON savings_goals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY savings_goals_authenticated_update
  ON savings_goals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY savings_goals_authenticated_delete
  ON savings_goals FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- -------------------------
-- 4. 3-goal cap trigger
-- -------------------------

CREATE OR REPLACE FUNCTION check_savings_goal_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM savings_goals WHERE user_id = NEW.user_id) >= 3 THEN
    RAISE EXCEPTION 'A user may not hold more than 3 active savings goals';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_savings_goal_limit
  BEFORE INSERT ON savings_goals
  FOR EACH ROW EXECUTE FUNCTION check_savings_goal_limit();
