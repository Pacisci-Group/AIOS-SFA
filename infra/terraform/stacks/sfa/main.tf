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

  # ── Which topology this environment runs ──────────────────────────────────
  #
  # Everything below reads these rather than testing the flag directly, so the
  # two shapes are described once instead of at every call site.
  #
  #   false: one app droplet, addressed directly. Today's production.
  #   true:  an autoscale pool behind a load balancer, addressed by tag.
  pool = var.enable_autoscale

  # The tag is the pool's stable name. Droplet ids are not knowable at plan time
  # and change as it scales, so firewalls, the database allow-list and the load
  # balancers all target this instead.
  pool_tag = "${local.name_prefix}-pool"

  # The app droplet, as a list, so a `[0]` deference never appears in a branch
  # that is not taken.
  app_droplet_ids = local.pool ? [] : [module.droplet[0].id]
  app_tags        = local.pool ? [local.pool_tag] : []

  # The address the world reaches this environment on. The load balancer when
  # there is one, the droplet's reserved IP otherwise. This is what DNS points
  # at and what an agency puts in an A record, so it must never silently become
  # an address that only works for one droplet.
  public_ip = local.pool ? module.public_lb[0].ip : module.droplet[0].public_ip

  # Where Inngest invokes our functions. The internal balancer fans out across
  # the pool; a single droplet answers on its own private address.
  worker_endpoint = local.pool ? module.worker_lb[0].ip : (
    length(module.droplet) > 0 ? module.droplet[0].ipv4_address_private : ""
  )
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

# ⚠ This block is what stops the previous line from destroying production.
#
# Adding `count` to a module renames every resource inside it from
# `module.droplet.x` to `module.droplet[0].x`. Terraform matches state by
# address, so without this it reads the rename as "the old droplet is gone,
# build a new one" — and plans to destroy and recreate the app droplet of every
# environment that is NOT autoscaling. Which is production.
#
# The plan would say `must be replaced`, with no hint that a `count` on an
# unrelated flag caused it. This tells Terraform the address moved and nothing
# else changed, so an environment left on the old topology plans clean.
#
# Safe to keep indefinitely, and it must be kept for as long as any state
# anywhere still predates the `count`.
moved {
  from = module.droplet
  to   = module.droplet[0]
}

# The single app droplet. NOT created when this environment runs a pool.
#
# `count` rather than deleting it: production still runs this shape, and the
# whole point of the flag is that production's plan stays empty while dev moves.
module "droplet" {
  count  = local.pool ? 0 : 1
  source = "../../modules/droplet"

  name                 = "${local.name_prefix}-app"
  region               = var.region
  size                 = var.droplet_size
  vpc_uuid             = module.vpc.id
  ssh_key_fingerprints = [digitalocean_ssh_key.deploy.fingerprint]
  enable_monitoring    = true
  enable_reserved_ip   = var.enable_reserved_ip
  tags                 = local.all_tags

  # `enable_tls` is deliberately NOT passed. Neither edge has a boot-time
  # issuance step to switch on or off: Caddy obtained certificates on demand, and
  # the Node edge obtains them from the worker via ACME. The variable survives
  # because `web_origin` above still needs to know the scheme.
  #
  # Two SEPARATE template files selected by a flag, never one template with a
  # conditional inside it. `user_data` cannot be changed in place, so an edit to
  # the file an environment already uses replaces that environment's droplet —
  # which is precisely what must not happen to production while dev is being
  # rebuilt. Keeping `cloud-init.yaml.tpl` byte-for-byte untouched is what makes
  # a production plan a no-op. Same reasoning as the Inngest droplet's template.
  user_data = var.enable_node_edge ? templatefile("${path.module}/../../modules/droplet/templates/cloud-init-edge.yaml.tpl", {
    ssh_public_key = var.ssh_public_key
    domain         = var.domain
    certbot_email  = var.certbot_email
    }) : templatefile("${path.module}/../../modules/droplet/templates/cloud-init.yaml.tpl", {
    ssh_public_key = var.ssh_public_key
    domain         = var.domain
    certbot_email  = var.certbot_email
  })
}

module "firewall" {
  source = "../../modules/firewall"

  name        = "${local.name_prefix}-fw"
  droplet_ids = local.app_droplet_ids
  # Pool members are covered by tag, because they do not exist yet. A droplet
  # that came up outside this firewall would have its SSH port open to the
  # internet.
  droplet_tags    = local.app_tags
  ssh_allowed_ips = var.ssh_allowed_ips

  # Public 80/443 direct to the droplet ONLY when there is no balancer in front.
  # With a pool, the balancer is the only thing that may reach these ports, and
  # `load_balancer_rules` below says so precisely.
  allow_http_https = !local.pool

  # Inngest invokes our functions over HTTP, so it needs to reach /api/inngest.
  #
  # ⚠ Which port depends on `enable_node_edge`, and the two sides must agree.
  #   * false (today's production): the API serves the functions in-process on
  #     4000, because the worker runs inline.
  #   * true: the worker is its own container on 4001 and is the only process
  #     serving them — exactly one may, and an autoscaled API tier cannot
  #     satisfy that. The API then serves none and binds loopback only.
  #
  # Open the wrong one and Inngest reports perfectly healthy while syncing zero
  # functions: the port is open with nothing behind it, every invocation is
  # refused, and no async work runs. The `deploy-inngest` job's
  # `functionCount > 0` assertion is what catches it.
  #
  # Deliberately NOT routed through the public edge: putting the endpoint behind
  # the public vhost would expose it to the internet for no reason.
  #
  # `docker-compose.prod.yml` binds the container to the droplet's private IP
  # (WORKER_INNGEST_BIND / API_INNGEST_BIND), and this rule is what makes that
  # address reachable — sharing a VPC is not enough, a DO firewall filters
  # neighbours too.
  internal_rules = var.enable_inngest ? [
    {
      port               = var.enable_node_edge ? "4001" : "4000"
      source_droplet_ids = [module.inngest_droplet[0].id]
    }
  ] : []

  # With a pool, the public balancer carries 80/443 and the internal one carries
  # the worker's 4001, and the health-check port is reachable from the public
  # balancer alone — never from the internet, where it would be an
  # unauthenticated endpoint on every droplet.
  load_balancer_rules = local.pool ? [
    {
      port                      = "80"
      source_load_balancer_uids = [module.public_lb[0].id]
    },
    {
      port                      = "443"
      source_load_balancer_uids = [module.public_lb[0].id]
    },
    {
      port                      = "8081"
      source_load_balancer_uids = [module.public_lb[0].id]
    },
    {
      port                      = "4001"
      source_load_balancer_uids = [module.worker_lb[0].id]
    },
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

  # Inngest is reached BY the app, so the source is the app tier — a single
  # droplet, or every member of the pool by tag.
  internal_rules = [
    merge(
      { port = "8288" },
      local.pool
      ? { source_tags = [local.pool_tag] }
      : { source_droplet_ids = local.app_droplet_ids },
    )
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
  allowed_droplet_ids = local.app_droplet_ids
  # ⚠ The pool is admitted by TAG. An id-based rule would admit only the
  # droplets that existed at the last apply, so every droplet created by scaling
  # would be refused by the database — presenting as one node serving 500s while
  # its siblings are fine.
  allowed_tags         = local.app_tags
  allowed_ip_addresses = var.mongo_allowed_ip_addresses
  enable_backups       = var.enable_backups
}

module "dns" {
  count  = var.enable_dns ? 1 : 0
  source = "../../modules/dns"

  domain        = var.domain_root
  subdomain     = var.dns_subdomain
  ip_address    = local.public_ip
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

# ─── Horizontal autoscaling ───────────────────────────────────────────────────
#
# The app tier as a pool of interchangeable droplets behind a load balancer,
# instead of one droplet addressed directly.
#
# Interchangeable is the operative word, and it is what Phases 1-3 bought: TLS
# certificates live in MongoDB rather than on a node's disk, so a droplet created
# thirty seconds ago can serve a tenant domain added minutes ago having issued
# nothing. Without that, each node would run its own ACME client and race the
# others for the same hostnames.

resource "digitalocean_tag" "pool" {
  count = local.pool ? 1 : 0
  name  = local.pool_tag
}

# Where the pool reads its configuration. See modules/deploy_config: a droplet
# created at 3am has nothing to SSH to it, so the deploy publishes here and
# every droplet converges on the same object.
module "deploy_config" {
  count  = local.pool ? 1 : 0
  source = "../../modules/deploy_config"

  name   = "${local.name_prefix}-deploy-config"
  region = var.spaces_region
}

resource "digitalocean_droplet_autoscale" "app" {
  count = local.pool ? 1 : 0
  name  = "${local.name_prefix}-pool"

  config {
    min_instances = var.pool_min_instances
    max_instances = var.pool_max_instances

    # Scale on CPU. Memory is deliberately not a trigger: a Node process holds
    # heap it has not returned to the OS, so memory looks high and flat whether
    # or not the app is busy, and scaling on it would ratchet up and never come
    # back down.
    target_cpu_utilization = var.pool_target_cpu

    # Long enough that a deploy - during which every droplet restarts its
    # containers and briefly burns CPU - does not read as load and trigger a
    # scale-up chasing its own tail.
    cooldown_minutes = var.pool_cooldown_minutes
  }

  droplet_template {
    size     = var.droplet_size
    region   = var.region
    image    = "ubuntu-24-04-x64"
    vpc_uuid = module.vpc.id
    ssh_keys = [digitalocean_ssh_key.deploy.fingerprint]

    # The tag is how the balancers, the firewall and the database allow-list all
    # find these droplets. Without it a scaled-up droplet is invisible to every
    # one of them.
    tags = concat([digitalocean_tag.pool[0].name], local.all_tags)

    # Required for CPU-based scaling: without the agent there are no utilisation
    # metrics, and the pool has nothing to decide on.
    with_droplet_agent = true

    # ⚠ Changing this replaces every droplet in the pool. Nothing that varies
    # per deploy belongs here - that is what the config bucket is for.
    user_data = templatefile("${path.module}/../../modules/droplet/templates/cloud-init-pool.yaml.tpl", {
      ssh_public_key       = var.ssh_public_key
      config_bucket        = module.deploy_config[0].bucket
      config_endpoint      = module.deploy_config[0].endpoint
      config_region        = module.deploy_config[0].region
      config_access_key_id = module.deploy_config[0].bootstrap_access_key_id
      config_secret_key    = module.deploy_config[0].bootstrap_secret_key
    })
  }
}

# The public edge. TLS passes straight through to our own terminator, which is
# what keeps white-labelling working: terminating here would mean DigitalOcean
# holding a certificate per hostname, and for an agency-owned domain that is a
# manual upload per domain - the operator step the whole design removes.
module "public_lb" {
  count  = local.pool ? 1 : 0
  source = "../../modules/loadbalancer"

  name        = "${local.name_prefix}-lb"
  region      = var.region
  vpc_uuid    = module.vpc.id
  droplet_tag = digitalocean_tag.pool[0].name

  # Recovers the real client address, which the rate limits key on. Paired with
  # EDGE_PROXY_PROTOCOL on the app - enabling one side alone breaks every
  # connection through the balancer.
  enable_proxy_protocol = var.pool_proxy_protocol

  forwarding_rules = [
    {
      entry_port      = 80
      entry_protocol  = "tcp"
      target_port     = 80
      target_protocol = "tcp"
    },
    {
      entry_port      = 443
      entry_protocol  = "https"
      target_port     = 443
      target_protocol = "https"
      tls_passthrough = true
    },
  ]

  # ⚠ Port 8081, not 80 or 443.
  #
  # With PROXY protocol on, the balancer's own health check does NOT carry a
  # header - so checking 80 would have the edge drop it as malformed, mark every
  # droplet unhealthy, and leave the pool serving nothing while each droplet was
  # in fact fine. 8081 is a plain listener the edge never wraps, and the firewall
  # admits it from this balancer alone.
  healthcheck = {
    protocol = "http"
    port     = 8081
    path     = "/healthz"
  }
}

# How Inngest reaches the workers.
#
# INTERNAL, so it has no public address at all: /api/inngest is raw Express
# middleware that none of the global guards see, and its only authentication is
# the Inngest request signature.
#
# ⚠ No PROXY protocol here. Only the TLS edge parses that header; the worker's
# Express server would read it as a malformed HTTP request and fail every
# invocation.
module "worker_lb" {
  count  = local.pool ? 1 : 0
  source = "../../modules/loadbalancer"

  name        = "${local.name_prefix}-worker-lb"
  region      = var.region
  vpc_uuid    = module.vpc.id
  droplet_tag = digitalocean_tag.pool[0].name

  type    = "REGIONAL_NETWORK"
  network = "INTERNAL"

  forwarding_rules = [
    {
      entry_port      = 4001
      entry_protocol  = "tcp"
      target_port     = 4001
      target_protocol = "tcp"
    },
  ]

  # TCP rather than HTTP: the serve endpoint answers an unsigned GET with 401 by
  # design, which an HTTP check would read as unhealthy and pull every worker
  # out of rotation.
  healthcheck = {
    protocol = "tcp"
    port     = 4001
  }
}

resource "digitalocean_project_resources" "sfa" {
  count = var.project_id != "" ? 1 : 0

  project = var.project_id
  resources = concat(
    [
      module.vpc.urn,
      module.mongo.cluster_urn,
    ],
    local.pool ? [] : [module.droplet[0].urn],
    local.pool ? [module.public_lb[0].urn, module.worker_lb[0].urn] : [],
    var.enable_inngest ? [module.inngest_droplet[0].urn] : [],
    var.enable_spaces ? [module.spaces[0].urn] : [],
  )
}
