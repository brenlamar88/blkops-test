-- =====================================================================
-- Add "Inpatient Adol" to the unit_type enum
--
-- Adolescent inpatient is a real unit the activity (form 113) and referral
-- (form 135) forms need to record; the enum only had Adult / Geri / IOP, so
-- adolescent entries were landing as null. Additive, placed with the other
-- inpatient units.
-- =====================================================================

alter type unit_type add value if not exists 'Inpatient Adol' after 'Inpatient Geri';
