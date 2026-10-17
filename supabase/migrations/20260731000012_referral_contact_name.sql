-- =====================================================================
-- referrals.referral_contact_name — free-text referral contact for imports
--
-- In-app referrals link a contact via referral_contact_id. Imported historical
-- referrals name the contact as free text ("Name of Contact" on the old log),
-- with no login/contact record to point at — exactly the situation
-- source_rep_name handles for reps. This mirrors that: keep the original text
-- so the contact is visible even without a linked contact row. Reporting reads
-- the linked contact when present, else this.
-- =====================================================================

alter table referrals add column if not exists referral_contact_name text;

notify pgrst, 'reload schema';
