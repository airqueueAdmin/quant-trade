-- Set the default closing-bet notification threshold to 0.
-- This only changes the default for new rows.
-- Existing rows keep their current threshold_score values.

alter table if exists public.closing_bet_notifications
    alter column threshold_score set default 0;
