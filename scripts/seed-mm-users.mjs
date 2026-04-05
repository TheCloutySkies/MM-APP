/**
 * Generate SQL to seed mm_profiles with Argon2id hashes.
 * Run: node scripts/seed-mm-users.mjs > supabase/seed_mm_users.sql
 * Then apply seed SQL once in the Supabase SQL editor (after migration).
 *
 * Default initial keys are "init-<username>" — change INITIAL_KEYS before production.
 */
import argon2 from "argon2";

const users = [
  "alpha-kilo",
  "charlie-sierra",
  "golf-lima",
  "kilo-mike",
  "echo-juliet",
  "golf-sierra",
  "mm-guest1",
  "mm-guest2",
];

/** @type {Record<string, string>} */
const INITIAL_KEYS = Object.fromEntries(
  users.map((u) => [u, `init-${u}`]),
);

console.log("-- Generated seed — run after mm_schema migration\n");

for (const username of users) {
  const accessKey = INITIAL_KEYS[username];
  const hash = await argon2.hash(accessKey, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  console.log(
    `insert into public.mm_profiles (username, access_key_hash) values ('${username}', '${hash}') on conflict (username) do update set access_key_hash = excluded.access_key_hash;`,
  );
}

console.log(
  "\n-- Default passwords: init-<username> (e.g. init-alpha-kilo). Rotate after first login.",
);
