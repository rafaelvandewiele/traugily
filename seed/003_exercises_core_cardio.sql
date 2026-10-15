-- Seed: exercise catalogue part 3 — core and cardio patterns.

INSERT INTO exercises (id, slug, name_en, movement_pattern, primary_muscles, supporting_muscles, equipment, skill_level, safety_flags, replacement_group, review_status, version, created_at, updated_at, published_at) VALUES
  ('ex_plank', 'plank', 'Plank', 'core_anti_rotation', '["core"]', '["shoulders"]', '["bodyweight"]', 'beginner', '[]', 'rg_core', 'published', 1, datetime('now'), datetime('now'), datetime('now')),
  ('ex_dead_bug', 'dead-bug', 'Dead Bug', 'core_anti_rotation', '["core"]', '["hipFlexors"]', '["bodyweight"]', 'beginner', '[]', 'rg_core', 'published', 1, datetime('now'), datetime('now'), datetime('now')),
  ('ex_cable_crunch', 'cable-crunch', 'Cable Crunch', 'core_flexion', '["abs"]', '["obliques"]', '["cables"]', 'intermediate', '[]', 'rg_core', 'published', 1, datetime('now'), datetime('now'), datetime('now')),
  ('ex_brisk_walk', 'brisk-walk', 'Brisk Walk', 'cardio_steady', '["cardio"]', '["legs"]', '["bodyweight"]', 'beginner', '[]', 'rg_cardio', 'published', 1, datetime('now'), datetime('now'), datetime('now')),
  ('ex_cycling_steady', 'cycling-steady', 'Stationary Bike (Steady)', 'cardio_steady', '["cardio"]', '["quads"]', '["cardio","machines"]', 'beginner', '[]', 'rg_cardio', 'published', 1, datetime('now'), datetime('now'), datetime('now')),
  ('ex_rowing_machine', 'rowing-machine', 'Rowing Machine', 'cardio_steady', '["cardio"]', '["back","legs"]', '["cardio","machines"]', 'beginner', '["warm_up_required"]', 'rg_cardio', 'published', 1, datetime('now'), datetime('now'), datetime('now'));

-- Replacement rules: safe alternatives within the same movement group.
INSERT INTO replacement_rules (id, group_id, exercise_id, replacement_exercise_id, priority, note, status, created_at) VALUES
  ('rr_bench_db', 'rg_horizontal_push', 'ex_bench_press', 'ex_dumbbell_press', 10, 'Comparable horizontal press with dumbbells.', 'active', datetime('now')),
  ('rr_bench_pushup', 'rg_horizontal_push', 'ex_bench_press', 'ex_push_up', 5, 'Bodyweight horizontal press pattern.', 'active', datetime('now')),
  ('rr_bench_machine', 'rg_horizontal_push', 'ex_bench_press', 'ex_machine_chest_press', 8, 'Machine press when free weights are busy.', 'active', datetime('now')),
  ('rr_bench_fly', 'rg_horizontal_push', 'ex_cable_fly', 'ex_dumbbell_press', 6, 'Press instead of fly when cables are busy.', 'active', datetime('now')),
  ('rr_squat_bw', 'rg_squat', 'ex_goblet_squat', 'ex_bodyweight_squat', 10, 'Same squat pattern without equipment.', 'active', datetime('now')),
  ('rr_squat_press', 'rg_squat', 'ex_goblet_squat', 'ex_leg_press', 8, 'Machine squat alternative.', 'active', datetime('now')),
  ('rr_pullup_pulldown', 'rg_vertical_pull', 'ex_pull_up', 'ex_lat_pulldown', 10, 'Assisted vertical pull equivalent.', 'active', datetime('now')),
  ('rr_row_db', 'rg_horizontal_pull', 'ex_bent_over_row', 'ex_dumbbell_row', 10, 'Same pattern with more back support.', 'active', datetime('now')),
  ('rr_row_cable', 'rg_horizontal_pull', 'ex_bent_over_row', 'ex_seated_row', 8, 'Supported horizontal pull.', 'active', datetime('now')),
  ('rr_hinge_bridge', 'rg_hinge', 'ex_romanian_deadlift', 'ex_glute_bridge', 6, 'Gentler hinge pattern for home or recovery days.', 'active', datetime('now')),
  ('rr_hinge_swing', 'rg_hinge', 'ex_romanian_deadlift', 'ex_kettlebell_swing', 8, 'Dynamic hinge alternative.', 'active', datetime('now')),
  ('rr_ohp_db', 'rg_vertical_push', 'ex_overhead_press', 'ex_dumbbell_shoulder_press', 10, 'Dumbbell overhead press alternative.', 'active', datetime('now')),
  ('rr_cardio_bike', 'rg_cardio', 'ex_rowing_machine', 'ex_cycling_steady', 8, 'Lower-impact steady cardio.', 'active', datetime('now')),
  ('rr_cardio_walk', 'rg_cardio', 'ex_rowing_machine', 'ex_brisk_walk', 6, 'Gentlest steady cardio option.', 'active', datetime('now'));