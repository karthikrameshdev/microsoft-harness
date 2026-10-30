---
name: schema-migration-validator
description: Verifies current schema evidence, backward compatibility checks, and reviewable execution boundaries before approved migrations.
version: 1.0.0
---

# Schema Migration Validator

## Objective
Validate that proposed database schema changes meet non-breaking backward compatibility requirements, have verifiable pre-execution checks, and isolate risks.

## Preconditions
- Current live schema dump available as read-only evidence.
- Migration script provided.
- Verification checks: no table locks on high-traffic tables, nullable new columns or default values supplied.
