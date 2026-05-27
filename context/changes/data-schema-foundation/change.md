---
id: data-schema-foundation
title: "Data schema: transactions, savings_goals, categories + RLS"
roadmap_ref: F-01
status: implementing
created: 2026-05-27
updated: 2026-05-27
---

## Summary

Creates the domain data layer for SpendLens: `categories`, `transactions`, and `savings_goals` tables in Supabase with strict per-user RLS, a pre-seeded category taxonomy, TypeScript entity types, and thin service helpers. No user-visible surface. Unblocks every downstream roadmap slice.

## Prerequisites

None.

## Unlocks

S-01 (connect-simulated-bank), S-04 (create-savings-goal), and transitively S-02 / S-03 / S-05 / S-06 / S-07.
