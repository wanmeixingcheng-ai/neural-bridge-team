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

## 3.1 Japan Real Estate Knowledge Brain Baseline

```text
- The first core asset of this project is the Japan real estate industry database and Knowledge Brain.
- UI, persona agents, reports, workflow automation, and marketing are application layers that call the knowledge asset.
- Phase 0 / Phase 1 development must prioritize database schemas, source registry, evidence chain, review state, risk state, and versioned knowledge units.
- Without source-backed, reviewable, versioned industry data, this project must not be described as a full industry brain.
- High-risk knowledge must include source_id, review_status, risk_level, and version before it can be reused.
```

### Knowledge Brain cold-start plan

```text
- Knowledge Brain cold-start is a product-critical bottleneck and must be treated as Phase 1 / Phase 2 scope, not as a later content task.
- v0.1 should prioritize quality-gated coverage over raw volume: target 800-1,500 approved knowledge units and 300-500 eval cases before broad external use.
- The prior commercial target of 1,000-3,000 approved knowledge units may be used only when source coverage, reviewer capacity, and evidence quality are visible.
- v1.0 scale targets such as 100,000-300,000 knowledge units are long-term knowledge asset goals, not MVP success criteria.
- Knowledge unit counts must not be inflated by arbitrary splitting; each unit must remain source-backed, reviewable, and useful for retrieval or policy evaluation.
```

### Approved cold-start source tiers

```text
- Tier 1 official public sources: MLIT, RETIO, Consumer Affairs Agency, and similar authorities. These are preferred for D07 contract / important matter, D08 legal / tax / loan boundary, and D16 prohibited actions / disclaimers.
- Tier 2 industry association materials: public templates, standard workflows, checklists, and sample wording from recognized real estate associations. These are preferred for D01-D03, D09, and D10 template-first workflows.
- Tier 3 partner practitioner cases: real but desensitized cases from cooperating宅建士 or real estate companies. These are preferred for D04-D06 high-value experiential domains and must have explicit contribution scope, source registry records, and reviewer metadata.
- Tier 4 AI-assisted drafts: AI may create draft material for long-tail domains such as D11-D15, but these records must enter as draft or candidate and must not become approved without human review.
- Publicly accessible material is not automatically training-eligible. License, consent_scope, retention policy, and training_allowed must be captured in Source Registry before downstream reuse.
```

### Cold-start phase gates

```text
- Phase 1 / 2.1: official public sources for D07, D08, and D16, target 300-500 approved source-backed units.
- Phase 1 / 2.2: association templates and workflows for D01, D02, D03, D09, and D10, target 400-600 approved source-backed units.
- Phase 1 / 2.3: partner practitioner cases for D04, D05, and D06, target 200-400 approved units, with宅建士 or equivalent reviewer metadata.
- Phase 1 / 2.4: AI-assisted drafts for D11-D15, target 300-500 candidate or approved-after-review units, with explicit disclaimers where cultural or subjective material is involved.
- Phase 1 / 2.5: Eval Set must cover all D01-D16 domains and include prohibited behavior, scenario, retrieval, and boundary cases before risky tools are exposed externally.
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
- REINS uploads, contracts, important matter explanations, customer records, and other high-risk business materials unless the user explicitly chooses a supported export or sync path
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

### Training data boundary

```text
- REINS, contracts, important matter explanations, customer records, personally identifiable information, and high-risk business materials are excluded from training pools by default.
- Free-tier data contribution requires explicit opt-in consent, a visible withdrawal path, and a deletion path.
- Opt-out, withdrawal, or deletion requests must be represented in source registry metadata before downstream reuse.
- No uploaded business material may be silently sent to cloud storage, third-party model providers, or training datasets.
- Partner practitioner cases and contributed real-world examples are non-training by default unless a separate explicit training grant exists.
- Source Registry must distinguish retrieval/reference use, summarization/derivative knowledge use, training use, and deletion/withdrawal state.
```

### REINS boundary

```text
- The product may provide only the official REINS login entrance: https://system.reins.jp/login/main/KG/GKG001200
- Users must log in on the official REINS page themselves, search themselves, and upload downloaded files or screenshots themselves.
- The system must not store REINS usernames or passwords.
- The system must not proxy REINS login, automate REINS browsing, scrape REINS pages, or bulk-download REINS content.
- REINS-derived uploads are high-risk user evidence by default, project-scoped by default, and excluded from training by default.
```

### LLM and calculation boundary

```text
- LLMs may extract, classify, summarize, explain, translate, and draft source-grounded text.
- LLMs must not be the authority for financial mathematics, investment returns, tax arithmetic, loan amortization, cap rates, or deterministic scoring.
- Financial and numeric calculations must be performed by deterministic code with inputs, formulas, outputs, and audit traces.
- High-risk conclusions involving contracts, important matter explanations, legal risk, financing, tax, rights relationships, or customer-sensitive facts require expert confirmation before being treated as approved knowledge.
- The model must not generate source-less industry conclusions; high-risk output must reference approved evidence or state that evidence is missing.
```

### High-risk product tool rollout

```text
- M4 valuation rationale and M5 contract risk check are high-value but high-risk tools and must initially be treated as internal employee assistive tools.
- M4 / M5 outputs must be framed as review candidates or "needs confirmation" findings, not as final legal, financial, tax, or brokerage advice.
- M4 / M5 must require approved source references, evidence refs, policy rules, and Eval Set coverage before external release.
- Eval Set E12 coverage for M4 / M5 must be stricter than template-first tools and include false-negative tests for missing "needs confirmation" flags.
- Customer-facing M4 / M5 release requires an explicit human approval decision after internal validation and expert review workflow evidence.
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
