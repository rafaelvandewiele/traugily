-- Seed: meal suggestions (coarse estimates only — never medical precision).

INSERT INTO meal_suggestions (id, slug, category, tags, approx_kcal, approx_protein_g, approx_carbs_g, approx_fat_g, status, version, created_at, updated_at) VALUES
  ('ms_oats_yogurt', 'oats-yogurt-berries', 'breakfast', '["quick","high_protein","budget"]', 420, 25, 55, 12, 'published', 1, datetime('now'), datetime('now')),
  ('ms_eggs_toast', 'eggs-on-toast', 'breakfast', '["quick","budget"]', 380, 20, 30, 18, 'published', 1, datetime('now'), datetime('now')),
  ('ms_smoothie', 'protein-smoothie', 'breakfast', '["quick","vegetarian"]', 320, 28, 38, 6, 'published', 1, datetime('now'), datetime('now')),
  ('ms_chicken_bowl', 'chicken-rice-bowl', 'lunch', '["high_protein","meal_prep"]', 550, 40, 60, 14, 'published', 1, datetime('now'), datetime('now')),
  ('ms_lentil_soup', 'lentil-soup', 'lunch', '["vegan","budget"]', 380, 20, 50, 8, 'published', 1, datetime('now'), datetime('now')),
  ('ms_wrap_beans', 'bean-wrap', 'lunch', '["vegetarian","quick","budget"]', 450, 22, 52, 15, 'published', 1, datetime('now'), datetime('now')),
  ('ms_salmon_potato', 'salmon-and-potatoes', 'dinner', '["high_protein"]', 580, 38, 48, 22, 'published', 1, datetime('now'), datetime('now')),
  ('ms_tofu_stirfry', 'tofu-stir-fry', 'dinner', '["vegan","quick"]', 480, 26, 45, 20, 'published', 1, datetime('now'), datetime('now')),
  ('ms_pasta_bolognese', 'pasta-bolognese', 'dinner', '["budget","meal_prep"]', 600, 35, 70, 18, 'published', 1, datetime('now'), datetime('now')),
  ('ms_greek_yogurt', 'greek-yogurt-honey', 'snack', '["quick","high_protein","vegetarian"]', 180, 15, 20, 5, 'published', 1, datetime('now'), datetime('now')),
  ('ms_apple_nuts', 'apple-and-nuts', 'snack', '["quick","vegan"]', 200, 5, 20, 12, 'published', 1, datetime('now'), datetime('now')),
  ('ms_pb_sandwich', 'peanut-butter-sandwich', 'snack', '["budget","vegan"]', 320, 12, 34, 16, 'published', 1, datetime('now'), datetime('now'));

INSERT INTO meal_suggestion_translations (suggestion_id, locale, title, description, ingredients, steps, substitutions, updated_at) VALUES
  ('ms_oats_yogurt', 'nl', 'Havermout met yoghurt en bessen', 'Snelle havermout met Griekse yoghurt en fruit.', '["50g havermout","150g Griekse yoghurt","Handvol bessen","1 tl honing"]', '["Kook de havermout","Roer de yoghurt erdoor","Top met bessen en honing"]', '["Plantaardige yoghurt","Anders fruit dan bessen"]', datetime('now')),
  ('ms_oats_yogurt', 'fr', 'Flocons d’avoine, yaourt et baies', 'Flocons d’avoine rapides avec yaourt grec et fruits.', '["50g de flocons","150g de yaourt grec","Une poignée de baies","1 c. à café de miel"]', '["Cuire les flocons","Mélanger le yaourt","Ajouter baies et miel"]', '["Yaourt végétal","Autres fruits"]', datetime('now')),
  ('ms_oats_yogurt', 'de', 'Haferflocken mit Joghurt und Beeren', 'Schnelle Haferflocken mit griechischem Joghurt und Früchten.', '["50g Haferflocken","150g griechischer Joghurt","Handvoll Beeren","1 TL Honig"]', '["Haferflocken kochen","Joghurt unterrühren","Mit Beeren und Honig toppen"]', '["Pflanzlicher Joghurt","Andere Früchte"]', datetime('now')),
  ('ms_salmon_potato', 'nl', 'Zalm met aardappels', 'Gebakken zalm met gekookte aardappels en groenten.', '["150g zalmfilet","300g aardappels","Handvol groenten","Olie, zout, peper"]', '["Kook de aardappels","Bak de zalm goudbruin","Stoom de groenten"]', '["Kip in plaats van zalm","Zoete aardappel"]', datetime('now'));