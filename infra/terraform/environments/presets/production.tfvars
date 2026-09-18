environment   = "production"
region        = "nyc3"
spaces_region = "nyc3"

# ⚠ Must NOT be the 10.10.0.0/16 module default — dev already holds that, and
#   DigitalOcean rejects a range overlapping any other network in the ACCOUNT
#   (not merely the region). The collision does not appear in `terraform plan`;
#   it fails at apply, on the VPC, after nothing else has been created.
#
# ⚠ Fixed at creation. Changing it later replaces the VPC, and the droplets and
#   Managed MongoDB attached to it go with it.
vpc_ip_range = "10.20.0.0/16"

# With `enable_autoscale` below, this is no longer one droplet's size — it is the
# POOL MEMBER TEMPLATE's size, and the scale path is horizontal instead of a
# vertical resize.
#
# ⚠ Changing it REPLACES EVERY DROPLET IN THE POOL. It lives in
#   `droplet_template`, which DigitalOcean cannot alter in place, so a resize is
#   a rolling rebuild of the whole tier — not the short single reboot it used to
#   be. Mongo is still a vertical bump behind a maintenance window.
droplet_size     = "s-1vcpu-2gb"
mongo_size       = "db-s-1vcpu-1gb"
mongo_node_count = 1

# Deliberately empty, unlike dev. Every entry here is a standing hole in the
# database's network perimeter, and this cluster holds real client data. Add a
# named entry only when someone genuinely needs Compass/mongosh access, and
# remove it the same day. The app itself needs no entry — it connects from the
# droplet.
#
# ⚠ Declare access here, never in the DigitalOcean console. The firewall
#   resource owns the entire rule set, so a console-added rule is silently
#   deleted by the next apply of unrelated work.
mongo_allowed_ip_addresses = []

# DNS zone lives at GoDaddy, so terraform does not manage the record
# (enable_dns = false). `domain` is still what the platform host is called: it
# names the certificate the worker orders over ACME, and it is the origin the
# Spaces CORS rule is derived from.
domain_root   = "smithfamily.agency"
dns_subdomain = "app"
domain        = "app.smithfamily.agency"

# TLS is no longer issued on the box. Under `enable_node_edge` the worker obtains
# certificates over ACME and stores them in MongoDB, and the edge reads them by
# SNI — there is no Certbot, no nginx server_name, and nothing to run by hand
# after DNS resolves.
#
# Both of these survive only because the stack still reads them: `enable_tls`
# picks the scheme for `web_origin` (and therefore the Spaces CORS rule), and
# `certbot_email` is interpolated into the single-droplet cloud-init, which this
# environment no longer builds. Leave them as they are — `enable_tls = false`
# would silently rewrite the CORS origin to http:// and break every upload
# preflight.
enable_tls    = true
certbot_email = "awaris@paciscigroup.com"

# Production-only keypair (~/.ssh/sfa_prod_deploy). NOT dev's key: DigitalOcean
# rejects a second digitalocean_ssh_key carrying a public key already on the
# account, so reusing dev's would fail the first apply outright. Separate keys
# also mean a compromised dev key cannot reach production.
ssh_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHnzBtu1MWrvmBDRr5IFDPZbIIBpcuDl85xsNslIr4Rl sfa-prod-deploy"

# Must stay open: the deploy job SSHes in from GitHub-hosted runners, whose
# egress IPs are not fixed. Narrowing this requires a self-hosted runner.
ssh_allowed_ips = ["0.0.0.0/0"]

enable_dns         = false # zone at GoDaddy, record added by hand
create_domain_zone = false

# ⚠ Inert once `enable_autoscale` is true, and NOT a safety net.
#
# A reserved IP attaches to a droplet — `digitalocean_reserved_ip_assignment`
# takes a droplet_id and nothing else — so it cannot front a pool. It lives
# inside the droplet module, which autoscaling removes, so enabling the pool
# DESTROYS this reserved IP and production's public address becomes the load
# balancer's instead.
#
# ⚠ On production that is a LIVE CUTOVER, not dev's rehearsal of one. The
#   address GoDaddy currently points `app.smithfamily.agency` and
#   `*.app.smithfamily.agency` at stops answering the moment the apply
#   completes, and DigitalOcean releases it — there is no getting it back. Have
#   the balancer's address in hand and the GoDaddy records open BEFORE applying.
#   See DEPLOYMENT.md, "Cutting production over".
enable_reserved_ip = true

# Provisions the Inngest droplet — the event bus, scheduler and executor for
# ALL asynchronous work, which in practice means every outbound email.
#
# ⚠ Load-bearing. Left unset it defaults to false, and the failure is silent:
#   no Inngest droplet, port 4000 never opened to it, deploy-inngest skipped,
#   and not one email delivered — while every health check stays green.
#   It must agree with the `INNGEST_ENABLED` GitHub Environment variable.
enable_inngest = true

# The horizontally-scalable topology: our own Node TLS terminator instead of
# Caddy, certificates read from MongoDB, and the worker as its own container on
# 4001. Proven on dev since 2026-09-14 (handoff §14) before being set here.
#
# ⚠ Flipping this REPLACES the app droplet — `user_data` cannot be changed in
#   place. Moot here only because `enable_autoscale` below removes that droplet
#   outright; it is the pool's members that serve production afterwards.
#
# ⚠ It must agree with the app side, which is deployed from `main` rather than
#   from here. Terraform opens 4001 and drops Caddy; the deploy writes
#   WORKER_INLINE=false and starts the edge. Half of that is an environment that
#   looks healthy and runs no async work — no email leaves the platform.
#   Set NODE_EDGE_ENABLED=true and ACME_ENABLED=true on the production
#   GitHub Environment in the same change.
enable_node_edge = true

# Horizontal autoscaling. The app tier becomes a pool behind a load balancer
# instead of one directly-addressed droplet.
#
# ⚠ Pool members are NOT deployed to. They fetch published config from the
#   deploy bucket at boot and every 30s, so a droplet created during a spike has
#   nothing to SSH to it. Editing /opt/sfa/.env on a member is pointless; the
#   next tick overwrites it. Change the Environment secret and re-run the deploy.
#
# ⚠ pool_proxy_protocol must agree with EDGE_PROXY_PROTOCOL in the production
#   Environment. Either alone breaks every connection through the balancer: the
#   header is read as the first bytes of a TLS handshake, or it never arrives
#   and the edge drops the connection.
enable_autoscale = true

# One, same as dev: start at a single droplet and let CPU pull more in. The pool
# is here for the topology and the headroom, not to pre-buy capacity nobody is
# using yet.
#
# ⚠ A floor of one is not redundancy. Between a member dying and its
#   replacement answering there is nothing serving, and the same is true for the
#   whole of any change that rebuilds members (`droplet_size`, `user_data`).
#   Raising this to 2 is the fix, and it is a one-line change — nothing else in
#   this file depends on the value.
pool_min_instances = 1

# A ceiling, not a target: the bound on both a runaway scale-up and the bill.
pool_max_instances = 3

# Average CPU across the pool. Not higher: individual droplets sit well above
# the average, and scaling only begins once the average is already breached.
pool_target_cpu = 0.6

# Long enough to cover a deploy, during which every member restarts its
# containers and briefly burns CPU — otherwise that reads as load and triggers a
# scale-up chasing its own tail.
pool_cooldown_minutes = 10

# Recovers the real client address, which the public intake rate limits key on.
# Off, every caller appears to come from the balancer and those limits collapse
# into one shared bucket.
pool_proxy_protocol = true

# Object storage for document uploads (deal-audit attachments, lead intake).
# Applying this needs SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY exported
# alongside DIGITALOCEAN_TOKEN — buckets are managed over the S3 API, not the
# DO API.
enable_spaces = true

# ⚠ Documentation only — the managed_mongo module does not implement this;
#   DigitalOcean ties MongoDB backup retention to the cluster tier. Confirm
#   retention in the DO console before this holds real client data.
enable_backups = false

# Browser origins allowed to run presigned uploads. Pinned rather than derived:
# the derived value tracks `enable_tls`, so flipping that flag would silently
# rewrite the CORS rule to http:// and break every upload preflight.
spaces_cors_origins = ["https://app.smithfamily.agency"]

# ⚠ Declared in stacks/sfa/variables.tf but referenced by no resource — this is
#   documentation, not protection. Real safety comes from DigitalOcean's own
#   database delete protection and from never running `make destroy ENV=production`.
prevent_destroy = true

project_id = ""

tags = ["sfa", "production"]
