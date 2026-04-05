-- Dev/temporary access key for charlie-sierra: Cloutyskies69!
-- Hash: Argon2id (m=65536, t=3, p=4) — must match scripts/seed-mm-users.mjs / mm-login verifier.
-- Rotate or remove after testing.

update public.mm_profiles
set access_key_hash = '$argon2id$v=19$m=65536,t=3,p=4$Fnen/rXCMk1i4/IikxCumQ$nkd6Hhy/8abHXaG5lWSekbNcE6fqES0k5PA8uakQGIg'
where username = 'charlie-sierra';
