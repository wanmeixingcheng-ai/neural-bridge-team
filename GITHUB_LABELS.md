# GITHUB_LABELS.md

## Required Labels

```bash
gh label create "ai:triage" --color 1d76db --description "AI should read and plan this issue"
gh label create "audit-only" --color 5319e7 --description "Read-only repository audit; no code changes"
gh label create "risk:low" --color 0e8a16 --description "Low-risk task"
gh label create "risk:medium" --color fbca04 --description "Medium-risk task"
gh label create "risk:high" --color b60205 --description "High-risk task"
gh label create "ready-for-codex" --color 1d76db --description "Ready for Codex implementation"
gh label create "approved-for-codex" --color 5319e7 --description "Human approved implementation"
gh label create "needs-review" --color d4c5f9 --description "Needs Claude or human review"
gh label create "needs-revision" --color e99695 --description "Needs changes"
gh label create "needs-human-ci-review" --color bfdadc --description "Human CI review required"
gh label create "human-approved-workflow-change" --color b60205 --description "Human-approved protected workflow change"
```
