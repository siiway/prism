-- Migration 0077: Add restrict_member_list_for_members to teams
ALTER TABLE teams ADD COLUMN restrict_member_list_for_members INTEGER NOT NULL DEFAULT 0;
