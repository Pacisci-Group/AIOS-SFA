locals {
  name_prefix = "sfa-${var.environment}"
  all_tags    = concat(["sfa", var.environment], var.tags)

  # Origin the web app is served from — this is what the browser puts in the
  # `Origin` header when it PUTs a file to Spaces, so it has to match a CORS
  # rule on the bucket exactly (scheme included).
  web_origin = "${var.enable_tls ? "https" : "http"}://${var.domain}"

  # Derived from variables only — deliberately never from `module.droplet`.
  # Terraform builds dependency edges from every reference in an expression,
  # including the branch a conditional does not take, so naming the droplet here
  # would make `module.spaces` depend on the droplet and drag it into any
  # `-target`ed apply. Keeping this variable-only lets the bucket be applied on
  # its own. Every environment is reached by hostname, so the IP adds nothing.
  spaces_cors_origins = length(var.spaces_cors_origins) > 0 ? var.spaces_cors_origins : [local.web_origin]
}

resource "digitalocean_ssh_key" "deploy" {
  name       = "${local.name_prefix}-deploy"
  public_key = var.ssh_public_key
}

module "vpc" {
  source = "../../modules/vpc"

  name     = "${local.name_prefix}-vpc"
  region   = var.region
  ip_range = var.vpc_ip_range
}

module "droplet" {
  source = "../../modules/droplet"

  name                 = "${local.name_prefix}-app"
  region               = var.region
  size                 = var.droplet_size
  vpc_uuid             = module.vpc.id
  ssh_key_fingerprints = [digitalocean_ssh_key.deploy.fingerprint]
  enable_monitoring    = true
  enable_reserved_ip   = var.enable_reserved_ip
  tags                 = local.all_tags

  # `enable_tls` is deliberately NOT passed any more. The edge is Caddy, which
  # obtains certificates on demand for every hostname the app says it serves —
  # there is no boot-time issuance step left to switch on or off. The variable
  # survives because `web_origin` above still needs to know the scheme.
  user_data = templatefile("${path.module}/../../modules/droplet/templates/cloud-init.yaml.tpl", {
    ssh_public_key = var.ssh_public_key
    domain         = var.domain
    certbot_email  = var.certbot_email
  })
}

module "firewall" {
  source = "../../modules/firewall"

  name             = "${local.name_prefix}-fw"
  droplet_ids      = [module.droplet.id]
  ssh_allowed_ips  = var.ssh_allowed_ips
  allow_http_https = true

  # Inngest invokes our functions over HTTP, so it needs to reach the API's
  # /api/inngest on port 4000. Deliberately NOT routed through nginx: the nginx
  # config is baked into this droplet's cloud-init `user_data`, which cannot be
  # changed in place, and putting the endpoint behind the public vhost would
  # expose it to the internet for no reason.
  #
  # `docker-compose.prod.yml` binds the api container to the droplet's private
  # IP (API_INNGEST_BIND), and this rule is what makes that address reachable —
  # sharing a VPC is not enough, a DO firewall filters neighbours too.
  internal_rules = var.enable_inngest ? [
    {
      port               = "4000"
      source_droplet_ids = [module.inngest_droplet[0].id]
    }
  ] : []
}

# ─── Inngest ──────────────────────────────────────────────────────────────────
# The durable event bus, scheduler and executor for all asynchronous work.
# Its own droplet running one upstream container; nothing of ours is built for
# it. See docker-compose.inngest.yml.
module "inngest_droplet" {
  count  = var.enable_inngest ? 1 : 0
  source = "../../modules/droplet"

  name                 = "${local.name_prefix}-inngest"
  region               = var.region
  size                 = var.inngest_droplet_size
  vpc_uuid             = module.vpc.id
  ssh_key_fingerprints = [digitalocean_ssh_key.deploy.fingerprint]
  enable_monitoring    = true
  # Nothing reaches this droplet from the internet, so a stable public address
  # buys nothing. The app droplet finds it by private IP.
  enable_reserved_ip = false
  tags               = concat(local.all_tags, ["inngest"])

  # A separate template, NOT a conditional inside the app's. `user_data` is not
  # changeable in place — making the shared template conditional would replace
  # the running app droplet, which is what the presets warn about in capitals.
  user_data = templatefile("${path.module}/../../modules/droplet/templates/cloud-init-inngest.yaml.tpl", {
    ssh_public_key = var.ssh_public_key
    vpc_ip_range   = module.vpc.ip_range
  })
}

# ⚠ `allow_http_https = false` is load-bearing, not a default worth changing.
#
# Port 8288 serves Inngest's Event API, its REST/GraphQL API *and* its dashboard
# UI, and the self-hosted build ships with NO AUTHENTICATION on any of them.
# This firewall is the only thing between that dashboard and the internet.
module "inngest_firewall" {
  count  = var.enable_inngest ? 1 : 0
  source = "../../modules/firewall"

  name             = "${local.name_prefix}-inngest-fw"
  droplet_ids      = [module.inngest_droplet[0].id]
  ssh_allowed_ips  = var.ssh_allowed_ips
  allow_http_https = false

  internal_rules = [
    {
      port               = "8288"
      source_droplet_ids = [module.droplet.id]
    }
  ]
}

module "mongo" {
  source = "../../modules/managed_mongo"

  name       = "${local.name_prefix}-mongo"
  region     = var.region
  size       = var.mongo_size
  node_count = var.mongo_node_count
  // Deliberately NOT the Inngest droplet: it is an event bus and executor, and
  // never touches MongoDB. Our functions run on the app droplet.
  allowed_droplet_ids  = [module.droplet.id]
  allowed_ip_addresses = var.mongo_allowed_ip_addresses
  enable_backups       = var.enable_backups
}

module "dns" {
  count  = var.enable_dns ? 1 : 0
  source = "../../modules/dns"

  domain        = var.domain_root
  subdomain     = var.dns_subdomain
  ip_address    = module.droplet.public_ip
  create_domain = var.create_domain_zone
}

module "spaces" {
  count  = var.enable_spaces ? 1 : 0
  source = "../../modules/spaces"

  name                 = "${local.name_prefix}-files"
  region               = var.spaces_region
  cors_allowed_origins = local.spaces_cors_origins
  create_access_key    = var.create_spaces_access_key
}

resource "digitalocean_project_resources" "sfa" {
  count = var.project_id != "" ? 1 : 0

  project = var.project_id
  resources = concat(
    [
      module.vpc.urn,
      module.droplet.urn,
      module.mongo.cluster_urn,
    ],
    var.enable_inngest ? [module.inngest_droplet[0].urn] : [],
    var.enable_spaces ? [module.spaces[0].urn] : [],
  )
}
