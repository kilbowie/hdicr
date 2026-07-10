# HDICR CI/CD setup (P1a)

Two GitHub Actions workflows now live in `.github/workflows/`:

- **`ci.yml`** — on every PR and non-`main` push: `pnpm type-check`, `pnpm test`, `sam validate --lint`, and the migration hygiene check (`scripts/check-migrations.mjs`). No AWS credentials — safe on forks/PRs.
- **`deploy.yml`** — on push to `main`: `pnpm build` → `sam build` → `sam deploy` (config `hdicr-production`), using **GitHub OIDC** (no long-lived AWS keys). Runs in the `production` GitHub Environment so it can require manual approval.

GitHub-hosted `ubuntu-latest` runners ship the AWS SAM CLI and AWS CLI, so nothing installs them.

## One-time manual setup (requires AWS + GitHub admin)

### 1. GitHub OIDC provider in AWS (once per account)
If not already present, add the GitHub OIDC identity provider in IAM:
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

### 2. Deploy IAM role
Create a role (e.g. `hdicr-github-deploy`) with a trust policy restricting it to this repo and the `main` ref:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::440779547223:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike":  { "token.actions.githubusercontent.com:sub": "repo:kilbowie/hdicr:ref:refs/heads/main" }
  }
}
```

Permissions: the SAM deploy needs CloudFormation, Lambda, API Gateway, IAM (for the functions' execution roles), S3 (the `hdicr-sam-artifacts-1776018163` bucket), and `secretsmanager:GetSecretValue` on `/hdicr/prod/*` (samconfig resolves DB/Auth0/JWT secrets at deploy). Scope to least privilege; start from the AWS-managed `AWSCloudFormationFullAccess` + explicit Lambda/APIGW/S3/Secrets statements and tighten.

### 3. GitHub repo variable
Settings → Secrets and variables → Actions → **Variables** → add:
- `AWS_DEPLOY_ROLE_ARN` = the role ARN from step 2.

### 4. Protect the `production` environment
Settings → Environments → `production` → add **Required reviewers** (yourself). This makes every `main` deploy pause for approval — important because some changes require a coordinated manual step first (see below).

### 5. Marketplace-actions policy
The workflows use `actions/checkout`, `actions/setup-node`, and `aws-actions/configure-aws-credentials`. If the org restricts Actions to `local_only`, allow these (Settings → Actions → General → "Allow specified actions": add `actions/*` and `aws-actions/*`).

## Deploy-coordination note (representation scope enforcement)
`representation-service` now enforces `hdicr:representation:read|write`. **Before** the first `main` deploy that includes this change, grant those scopes to the TI M2M application in Auth0 (on the `https://hdicr.com` API — and the legacy `https://hdicr.trulyimagined.com` API while both are live). If deployed first, TI's representation calls will 403. The `production` environment approval gate (step 4) is the control point for this.
