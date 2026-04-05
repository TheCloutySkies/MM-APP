-- Ensure roster user charlie-sierra exists in mm_profiles.
-- Access key (dev): Cloutyskies69! — same Argon2id hash as 20260409120000. Rotate for production.

insert into public.mm_profiles (username, access_key_hash)
values (
  'charlie-sierra',
  '$argon2id$v=19$m=65536,t=3,p=4$Fnen/rXCMk1i4/IikxCumQ$nkd6Hhy/8abHXaG5lWSekbNcE6fqES0k5PA8uakQGIg'
)
on conflict (username) do update
set access_key_hash = excluded.access_key_hash;
