# Codex Issue Runner

Use this only once when starting Codex on a repository or issue.

```text
Open the GitHub repository and work only from the current Issue/PR context.
Follow AGENTS.md, PROJECT_CONSTRAINTS.md, NO_COPY_POLICY.md, AUDIT_ONLY_POLICY.md, RISK_LEVELS.md, and CI_REPAIR_POLICY.md.
Do not ask the user to paste repository files, PR diffs, or Issue contents if you can access them directly from GitHub.
If the Issue is audit-only, produce a read-only audit report as an Issue comment and do not modify files, commit, branch, or PR.
If implementation is allowed, create a feature branch and PR. Never merge.
```
