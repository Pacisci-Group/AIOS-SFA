# SFA Infrastructure (Terraform + DigitalOcean)

Infrastructure as Code for the SFA platform. Ships **dev only** today; staging
and production are one command away (`make create ENV=staging`).

## What it provisions (per environment)

- VPC (private networking)
- Droplet (Ubuntu 24.04, Docker + Nginx + Certbot via cloud-init)
- Cloud Firewall (SSH from allowlist, 80/443 public)
- Managed MongoDB (app DB + user + DB-level firewall to the droplet)
- DNS A record
- Spaces bucket for document uploads, with browser CORS rules and a
  bucket-scoped access key (`enable_spaces`; on for dev, staging and production)

The app itself runs as Docker Compose on the droplet (`docker-compose.prod.yml`)
and is deployed by CI, not by Terraform.

## Layout

```
infra/terraform/
  bootstrap/            # one-time remote state bucket (Spaces)
  modules/             # vpc, firewall, droplet, managed_mongo, dns, spaces
  stacks/sfa/          # single composable stack wiring all modules
  environments/
    _template/         # golden template (never applied directly)
    dev/               # the only live env initially
    presets/           # ready-to-use tfvars for dev/staging/production
  scripts/             # create-env.sh, destroy-env.sh
  Makefile
```

## Prerequisites

- Terraform >= 1.5
- A DigitalOcean API token
- A Spaces access key + secret. Needed for two distinct things: the remote state
  backend, and the `digitalocean` provider itself — Spaces buckets are managed
  over the S3 API, not the DO API, so `DIGITALOCEAN_TOKEN` alone cannot create
  the uploads bucket or its CORS rules
- An SSH keypair for the `deploy` user
- A domain zone in DigitalOcean DNS (or set `create_domain_zone = true`)

Export credentials:

```bash
export DIGITALOCEAN_TOKEN=dop_v1_xxx
export SPACES_ACCESS_KEY_ID=xxx
export SPACES_SECRET_ACCESS_KEY=xxx
# For the s3 backend used by environments:
export AWS_ACCESS_KEY_ID=$SPACES_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=$SPACES_SECRET_ACCESS_KEY
# For create-env.sh:
export TF_STATE_BUCKET=sfa-terraform-state
export TF_STATE_REGION=nyc3
```

## First-time setup (dev)

```bash
cd infra/terraform

# 1. Create the remote state bucket (once)
cp bootstrap/terraform.tfvars.example bootstrap/terraform.tfvars   # edit name
make bootstrap

# 2. Configure dev
cp environments/presets/dev.tfvars environments/dev/terraform.tfvars
cp environments/dev/backend.tf.example environments/dev/backend.tf
#   edit terraform.tfvars: domain_root, domain, ssh_public_key, ssh_allowed_ips
#   edit backend.tf: bucket name + region if changed

# 3. Apply
make init ENV=dev
make plan ENV=dev
make apply ENV=dev

# 4. Read outputs
make output ENV=dev
terraform -chdir=environments/dev output -raw mongodb_uri              # app .env
terraform -chdir=environments/dev output -raw spaces_bucket            # STORAGE_BUCKET
terraform -chdir=environments/dev output -raw spaces_endpoint          # STORAGE_ENDPOINT
terraform -chdir=environments/dev output -raw spaces_access_key_id     # STORAGE_ACCESS_KEY_ID
terraform -chdir=environments/dev output -raw spaces_secret_access_key # STORAGE_SECRET_ACCESS_KEY
```

## Creating staging or production later (one command)

```bash
# Edit the preset first (domain, ssh_allowed_ips, ssh_public_key):
#   environments/presets/staging.tfvars
make create ENV=staging
# or
make create ENV=production
```

`create-env.sh` copies `_template/` + `presets/<env>.tfvars`, renders the backend
key for that env, then runs `init` + `apply`. No HCL editing, no module changes.

## App deployment after infra is up

1. Get the Mongo URI: `terraform -chdir=environments/dev output -raw mongodb_uri`
2. Configure GitHub secrets (see root `DEPLOYMENT.md`) and push to `main`, or
   deploy manually:
   - Copy `docker-compose.prod.yml` to `/opt/sfa/` on the droplet
   - Create `/opt/sfa/.env` (from `.env.prod.example`)
   - `docker compose -f docker-compose.prod.yml up -d`
3. One-time seed:
   `docker compose -f docker-compose.prod.yml run --rm api node packages/api/dist/seed/seed.js`
4. TLS: `sudo certbot --nginx -d dev.example.com`

## Adding a new service later (e.g. Redis)

1. Add `modules/redis/`
2. Wire it into `stacks/sfa/main.tf` behind an `enable_redis` flag
3. Set the flag in the relevant preset
Every environment inherits it; enable per env via tfvars.

## Notes

- MongoDB user passwords and the Spaces access key/secret are only available at
  creation time; they live in state (sensitive). Keep the state bucket private +
  versioned.
- Uploads are presigned PUTs sent by the browser straight to Spaces, so the
  bucket's CORS rules must name the site's origin. `spaces_cors_origins` is
  derived from `domain`/`enable_tls` plus the droplet IP when left empty — after
  a DNS cutover or a TLS switch, re-apply so the rule follows the new origin.
  Getting this wrong fails only in the browser; the API stays healthy.
- `enable_backups` is a documentation flag: `modules/managed_mongo` does not
  implement it, because DO ties MongoDB backup retention to the cluster tier.
  Verify retention in the DO console for any environment holding real data.
- Destroy protection: `scripts/destroy-env.sh` refuses to destroy `production`.
  The `prevent_destroy` preset flag is a documentation marker — Terraform does not
  allow a variable in a `lifecycle { prevent_destroy }` block, so to hard-lock a
  production resource, add a literal `lifecycle { prevent_destroy = true }` to it.
- Never commit `terraform.tfvars` or `backend.tf` from live env dirs (gitignored).
