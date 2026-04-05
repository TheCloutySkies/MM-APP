# MM login (“Access” screen) troubleshooting

Login is **not** Supabase Auth email/password. It calls the Edge Function **`mm-login`**, which checks **`mm_profiles`** (`username` + **Argon2id** hash of the **access key**).

## Exact values for roster users

- **Username:** lowercase kebab-case as in the app allowlist, e.g. `charlie-sierra` (no spaces).
- **Access key (default after seed):** `init-<username>` → for Charlie Sierra that is **`init-charlie-sierra`** (hyphen after `init`, same hyphen style as the username).

## If login always fails

1. **Confirm env** — `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env` must be the **same project** where you applied migrations and seed.
2. **Confirm row exists** — In Supabase **SQL Editor**:
   ```sql
   select id, username, left(access_key_hash, 40) as hash_prefix
   from public.mm_profiles
   where username = 'charlie-sierra';
   ```
   - No row → run seed (below).
3. **(re)Apply seed hashes** — From repo root:
   ```bash
   node scripts/seed-mm-users.mjs > /tmp/mm_seed.sql
   ```
   Paste/run the SQL from that file in the **SQL Editor** (or use your bootstrap script). That sets `access_key_hash` from `init-<username>` using the same Argon2 parameters as `mm-login`.
4. **Deploy `mm-login`** — Function must be deployed with secrets (`scripts/supabase-bootstrap.sh` or `supabase functions deploy mm-login --no-verify-jwt`).
5. **After changing keys** — If you set a custom access key in the DB, you must **re-hash with Argon2id** (same params as `scripts/seed-mm-users.mjs`); plain text in `access_key_hash` will never work.

## Error messages (after latest `mm-login` deploy)

- **Unknown / not in mm_profiles** — Seed or wrong project.
- **Access key does not match** — Typo in key, or DB hash was generated with different password/parameters than the app expects.
