# PROJECT_CONSTRAINTS.md

## 1. Project Basics

```text
Project name: Neural Bridge Team
Repository: https://github.com/wanmeixingcheng-ai/neural-bridge-team
Primary production URL: https://neural-bridge-team.vercel.app
Technology stack: Next.js 16, React 18, Node.js 22, npm, Node test runner, Vercel deployment
Known services/dependencies: Neon serverless driver, Upstash Redis, PDF/DOCX parsing via pdfjs-dist and mammoth
Deployment environment: Vercel production. AI must not change production deployment settings without explicit human approval.
Primary users: project manager, internal team, future customers
```

## 2. AI Permission Boundary

### AI may do

```text
- Read repository source code
- Create feature branches
- Create pull requests
- Comment on Issues and PRs
- Run read-only audits
- Implement and test Low / Medium Risk tasks after the required labels are present
- Propose remediation plans and split audit findings into follow-up Issues
```

### AI must not do

```text
- Merge PRs
- Push directly to main/master after branch protection is enabled
- Modify GitHub Secrets
- Modify production database data or schema without explicit human approval
- Modify production deployment configuration without explicit human approval
- Print or expose real API keys, tokens, passwords, cookies, or private credentials
- Automatically deploy or promote production changes outside the approved CI/deployment flow
- Bypass audit-only, Local-only, risk, or human approval labels
```

## 3. Approved Technical Baseline

```text
- Package manager: npm with package-lock.json
- Runtime: Node.js 22.x
- Framework: Next.js app router
- UI: React 18 components
- Tests: npm run test
- Production build: npm run build
- Deployment target: Vercel
```

## 4. Dependency Policy

### Approved existing dependencies

```text
- next
- react
- react-dom
- @neondatabase/serverless
- @upstash/redis
- mammoth
- pdfjs-dist
```

### New dependency rules

```text
- Do not add runtime dependencies for simple utilities that can be implemented locally.
- Any dependency touching auth, secrets, networking, storage, payments, AI execution, or deployment is at least Medium Risk.
- New dependencies with install scripts, native binaries, telemetry, or unclear maintenance status require review before merge.
```

## 5. Data and Privacy Boundary

### Local-only or client-side data

```text
- Temporary uploaded files before user-confirmed processing
- Local workflow drafts and transient UI state
- Debug outputs that may contain user-provided task text
```

### Server-side data allowed only when intended by product behavior

```text
- Workflow records
- Workboard task state
- Artifact metadata and approved knowledge entries
- Audit logs that redact secrets
```

### Never upload or print

```text
- API keys
- GitHub tokens
- Vercel tokens
- Database URLs
- Redis URLs or tokens
- Passwords
- Session secrets
- Unredacted .env values
```

## 6. External API / Service Boundary

```text
- Approved model providers must be configured through environment variables only.
- Secrets must live in GitHub Secrets, Vercel environment variables, or the relevant provider dashboard.
- Secrets must never be hardcoded, committed, logged, or copied into Issue / PR comments.
- Local-only mode must block external model, web, deployment, and repository write actions unless explicitly overridden by policy.
```

## 7. Protected Files

Changes to these files are High Risk unless explicitly approved:

```text
- AGENTS.md
- CLAUDE.md
- AI_WORKFLOW.md
- NO_COPY_POLICY.md
- AUDIT_ONLY_POLICY.md
- AUTOMATION_POLICY.md
- PROJECT_CONSTRAINTS.md
- RISK_LEVELS.md
- CI_REPAIR_POLICY.md
- GITHUB_LABELS.md
- .github/workflows/
- .github/ISSUE_TEMPLATE/
- .github/PULL_REQUEST_TEMPLATE.md
- prompts/
- scripts/collect_audit_context.py
```

## 8. High Risk Automatic Classification

The following must be labeled `risk:high` and require explicit human approval before implementation:

```text
- Login, auth, sessions, permissions, or access control
- Database schema or production data migration
- API keys, secrets, environment variables, or credential handling
- GitHub Actions, CI/CD, branch protection, or workflow governance
- Vercel or other production deployment configuration
- Payment, billing, or customer account data
- Multi-agent prompts, system prompts, ARIA scheduling policy, Codex/Claude execution policy
- Local-only mode, audit-only mode, or tool permission gates
- Any change that can automatically execute external tools or write to GitHub
```

## 9. First Formal Task

```text
Before new feature development, create and process an audit-only Issue for this repository.
The audit must be read-only, must not modify files, must not create commits, and must not create PRs.
Use labels: audit-only, risk:medium.
```
