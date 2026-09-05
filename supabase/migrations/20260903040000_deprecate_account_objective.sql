-- One objective, one row (Stage 4).
--
-- The objective was editable in two places that were not the same place:
--
--   * `public.goals` — read by the dashboard, the goal screen and the committee
--     prompt. This is the objective the app actually uses.
--   * `public.accounts.starting_value` / `target_value` / `target_date` —
--     editable in Settings' per-account form and read by NOTHING. Setting a
--     target there looked like setting a target and set nothing, and the two
--     could disagree indefinitely without any screen noticing.
--
-- The app no longer writes the account-level columns (enforced by a guard test
-- in `promptMandate.test.ts`, so a third writer cannot reappear quietly).
--
-- THE COLUMNS ARE NOT DROPPED HERE, AND THAT IS DELIBERATE.
--
-- The brief says to delete them. Dropping a column destroys whatever is in it,
-- irreversibly, on a database that deploys live the moment this merges — and
-- these columns may hold a target the owner typed and still means. Marking them
-- deprecated is the reversible half and costs nothing; the drop is a one-way
-- door and is his to open. Settings shows any surviving value as an "unused
-- account target" rather than hiding it, so nothing disappears silently in the
-- meantime.
--
-- To finish the job once the values are confirmed dead:
--
--   ALTER TABLE public.accounts
--     DROP COLUMN starting_value,
--     DROP COLUMN target_value,
--     DROP COLUMN target_date;
--
-- Not money-adjacent in itself — this migration changes no value and computes
-- nothing. It records which of two disagreeing objectives is authoritative.
COMMENT ON COLUMN public.accounts.target_value IS
  'DEPRECATED (2026-09-03, Stage 4). The objective lives in public.goals, which the dashboard, goal screen and committee prompt read. Nothing reads this column and the app no longer writes it. Retained so existing values are not destroyed; safe to drop once confirmed dead.';
COMMENT ON COLUMN public.accounts.target_date IS
  'DEPRECATED (2026-09-03, Stage 4). See accounts.target_value. Use goals.target_date.';
COMMENT ON COLUMN public.accounts.starting_value IS
  'DEPRECATED (2026-09-03, Stage 4). See accounts.target_value. Use goals.starting_value.';

COMMENT ON TABLE public.goals IS
  'The single objective: target value, target date, starting value, monthly contribution, risk and margin preference. Read by the dashboard, the goal screen and the committee prompt; edited on the goal screen and in Settings. accounts.target_value/target_date/starting_value are a deprecated second copy that nothing reads.';
