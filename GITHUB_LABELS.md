# GITHUB_LABELS.md

## Purpose

Use these labels to keep AI-assisted development tasks consistent across repositories.

This file is documentation only. It does not grant permission to bypass GitHub branch protection, CI, Claude review, or human approval.

## Risk Labels

- `risk:low` — Documentation, copy, formatting, isolated tests, small UI polish, or other low-risk changes.
- `risk:medium` — Feature behavior, forms, state changes, API calls, cross-file logic, or user-visible bug fixes.
- `risk:high` — Authentication, authorization, payment, permissions, database, deployment, CI/CD, secrets, infrastructure, or architecture migration.

Every AI-assisted PR should have exactly one risk label.

## Codex Execution Labels

- `ready-for-codex` — The Issue has enough context, acceptance criteria, and constraints for Codex to begin implementation.
- `approved-for-codex` — A human owner has approved Codex implementation, usually required for medium or high-risk work.

## Review Labels

- `needs-review` — The PR needs Claude review, human review, or both.
- `needs-revision` — The PR requires changes before merge.

## CI Repair Labels

- `ci-repair-allowed` — Codex may attempt one CI repair when the failure is likely caused by the current PR and the repair stays within scope.
- `needs-human-ci-review` — CI failure needs human review before Codex continues.

## Protected Workflow Exception

- `human-approved-workflow-change` — The only allowed exception for modifying protected workflow files. Use only when a human owner explicitly approves the protected-file change.

## Recommended First Labels

For a basic repository setup, create:

```bash
gh label create "risk:low" --color 0e8a16 --description "Low-risk AI-assisted task"
gh label create "risk:medium" --color fbca04 --description "Medium-risk AI-assisted task"
gh label create "risk:high" --color b60205 --description "High-risk AI-assisted task"
gh label create "ready-for-codex" --color 1d76db --description "Ready for Codex implementation"
gh label create "approved-for-codex" --color 5319e7 --description "Human-approved for Codex implementation"
gh label create "needs-review" --color d4c5f9 --description "Needs review"
gh label create "needs-revision" --color e99695 --description "Needs changes"
gh label create "ci-repair-allowed" --color c5def5 --description "Codex may attempt one CI repair"
gh label create "needs-human-ci-review" --color bfdadc --description "Human review required for CI failure"
gh label create "human-approved-workflow-change" --color b60205 --description "Human-approved protected workflow change"
```
