output "environment" {
  value = var.environment
}

output "region" {
  value = var.region
}

output "droplet_id" {
  description = "The single app droplet. Null when this environment runs an autoscale pool, whose members have no fixed id."
  value       = local.pool ? null : module.droplet[0].id
}

output "pool_id" {
  description = "The autoscale pool, when there is one."
  value       = local.pool ? digitalocean_droplet_autoscale.app[0].id : null
}

# The address to point DNS at. Read this one.
#
# `droplet_ip` below is the same value under its historical name, kept because
# DEPLOYMENT.md and existing runbooks say it — but the name is a lie once there
# is a pool, where it returns the LOAD BALANCER's address and no droplet's.
output "public_ip" {
  description = <<-EOT
    The address the world reaches this environment on.

    With a pool: the load balancer's address. Without one: the droplet's
    reserved IP.

    Three things must carry it, and missing any is silent:
      * the platform host's A record
      * the WILDCARD A record, which every agency subdomain depends on
      * PUBLIC_SERVER_IPS, which is what a custom-domain owner is told to put
        in their own A record
  EOT
  value       = local.public_ip
}

output "droplet_ip" {
  description = <<-EOT
    The address the world reaches this environment on: the load balancer's when
    there is a pool, the droplet's reserved IP otherwise.

    This is what DNS points at, what an agency puts in an A record, and what
    PUBLIC_SERVER_IPS must carry. It is NOT an SSH target once a pool exists —
    pool members are not deployed to, and `ssh_command` says so.
  EOT
  value       = local.public_ip
}

output "droplet_private_ip" {
  description = "VPC address of the single app droplet. Null with a pool — use `worker_endpoint`, which is stable across scaling."
  value       = local.pool ? null : module.droplet[0].ipv4_address_private
}

output "worker_endpoint" {
  description = <<-EOT
    Where Inngest invokes our functions: the internal load balancer with a pool,
    the single droplet's private address otherwise.

    Goes into the APP_PRIVATE_IP Environment secret. With a pool this is stable
    across scaling, which is the point — an individual droplet's address is not.
  EOT
  value       = local.worker_endpoint
}

output "firewall_id" {
  value = module.firewall.id
}

output "domain" {
  value = var.domain
}

output "fqdn" {
  value = var.enable_dns ? module.dns[0].fqdn : var.domain
}

output "mongodb_uri" {
  description = "Application MongoDB connection string"
  value       = module.mongo.connection_uri
  sensitive   = true
}

output "mongodb_host" {
  value = module.mongo.host
}

output "spaces_bucket" {
  description = "Object storage bucket name (STORAGE_BUCKET)"
  value       = var.enable_spaces ? module.spaces[0].name : null
}

output "spaces_endpoint" {
  description = "Object storage endpoint (STORAGE_ENDPOINT)"
  value       = var.enable_spaces ? module.spaces[0].endpoint : null
}

output "spaces_region" {
  description = "Object storage region (STORAGE_REGION)"
  value       = var.enable_spaces ? module.spaces[0].region : null
}

output "spaces_access_key_id" {
  description = "Bucket-scoped access key ID (STORAGE_ACCESS_KEY_ID)"
  value       = var.enable_spaces ? module.spaces[0].access_key_id : null
}

output "spaces_secret_access_key" {
  description = "Bucket-scoped secret (STORAGE_SECRET_ACCESS_KEY)"
  value       = var.enable_spaces ? module.spaces[0].secret_access_key : null
  sensitive   = true
}

output "spaces_cors_origins" {
  description = "Origins allowed to upload from a browser — must include the site the web app is served from"
  value       = var.enable_spaces ? module.spaces[0].cors_allowed_origins : null
}

output "ssh_command" {
  description = "Empty for a pool: its members are not deployed to and are replaced by DigitalOcean at will."
  value       = local.pool ? "" : "ssh deploy@${module.droplet[0].public_ip}"
}

# ─── Autoscale deploy config ──────────────────────────────────────────────────
#
# Where the deploy publishes, and what CI needs to publish there. Pool members
# read this bucket at boot and every 30s; there is no SSH step for them.

output "deploy_config_bucket" {
  value = local.pool ? module.deploy_config[0].bucket : null
}

output "deploy_config_endpoint" {
  value = local.pool ? module.deploy_config[0].endpoint : null
}

output "deploy_config_github_secrets" {
  description = <<-EOT
    The Environment secrets the deploy needs to publish config for the pool.

    Assembled as one output because the two keys are easy to confuse with the
    STORAGE_* pair and with each other: this is the READ/WRITE key, used only by
    CI. The droplets hold a separate read-only key, baked into user_data by
    terraform, which never passes through GitHub.
  EOT
  value = local.pool ? {
    DEPLOY_CONFIG_BUCKET        = module.deploy_config[0].bucket
    DEPLOY_CONFIG_ENDPOINT      = module.deploy_config[0].endpoint
    DEPLOY_CONFIG_REGION        = module.deploy_config[0].region
    DEPLOY_CONFIG_ACCESS_KEY_ID = module.deploy_config[0].publish_access_key_id
  } : null
}

output "deploy_config_secret_key" {
  description = "DEPLOY_CONFIG_SECRET_ACCESS_KEY. CI only."
  value       = local.pool ? module.deploy_config[0].publish_secret_key : null
  sensitive   = true
}

output "deploy_notes" {
  value = local.pool ? local.notes_pool : local.notes_single_droplet
}

# ─── Inngest ──────────────────────────────────────────────────────────────────

output "inngest_droplet_id" {
  value = var.enable_inngest ? module.inngest_droplet[0].id : null
}

output "inngest_droplet_ip" {
  description = "Public IP of the Inngest droplet. SSH only — no service is served publicly. Use as INNGEST_SSH_HOST in the deploy workflow, and to tunnel the dashboard: ssh -L 8288:localhost:8288 deploy@<ip>"
  value       = var.enable_inngest ? module.inngest_droplet[0].public_ip : null
}

output "inngest_droplet_private_ip" {
  description = "VPC address of the Inngest droplet. The API sends events here: INNGEST_BASE_URL=http://<this>:8288"
  value       = var.enable_inngest ? module.inngest_droplet[0].ipv4_address_private : null
}

# Every Inngest-related GitHub Environment secret that comes from infrastructure,
# already assembled and labelled:
#
#   terraform output inngest_github_secrets
#
# One output rather than three raw ones because two of the three are easy to get
# subtly wrong by hand — INNGEST_BASE_URL needs the PRIVATE address with a scheme
# and port, while APP_PRIVATE_IP is a bare address with neither. Assembling them
# here removes the chance of pasting a public IP into one or a port into the other.
#
# The remaining Inngest secrets are NOT infrastructure and are not here:
# INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are generated with `openssl rand -hex 32`,
# and RESEND_API_KEY / MAIL_DEFAULT_FROM come from Resend.
output "inngest_github_secrets" {
  description = "Inngest GitHub Environment secrets derived from infrastructure. Null until enable_inngest = true has been applied."
  value = var.enable_inngest ? {
    INNGEST_SSH_HOST = module.inngest_droplet[0].public_ip
    INNGEST_BASE_URL = "http://${module.inngest_droplet[0].ipv4_address_private}:8288"
    # With a pool this is the INTERNAL load balancer, not a droplet — stable
    # across scaling, which an individual member's address is not.
    APP_PRIVATE_IP = local.worker_endpoint
  } : null
}
