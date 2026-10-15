-- 0011_product_settings.sql — product-defined safety floors and configurable limits.
-- Note: plans.current_version_id has no enforced FK (SQLite cannot ALTER-add
-- constraints); the application only ever writes values from plan_versions.

-- Product-defined safety floors. TODO(nutrition/clinical): reviewed values required
-- before public launch. The engine refuses to go below these floors.
CREATE TABLE product_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);

INSERT INTO product_settings (key, value, description, updated_at) VALUES
  ('nutrition_floor_kcal_female', '1200', 'Minimum daily energy target for female members (kcal, estimate floor)', '2026-01-01T00:00:00Z'),
  ('nutrition_floor_kcal_male', '1500', 'Minimum daily energy target for male members (kcal, estimate floor)', '2026-01-01T00:00:00Z'),
  ('nutrition_floor_kcal_unspecified', '1400', 'Minimum daily energy target when sex is not provided (kcal, estimate floor)', '2026-01-01T00:00:00Z'),
  ('delinquency_cancel_days', '14', 'Days of unpaid subscription before automatic cancellation (data preserved)', '2026-01-01T00:00:00Z'),
  ('max_progress_photo_bytes', '10485760', 'Maximum upload size for progress photos (bytes)', '2026-01-01T00:00:00Z');