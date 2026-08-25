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

# Same sizing as dev, deliberately. Horizontal autoscaling of the API/web tier
# is a separate phase; until it lands the scale path is a vertical resize
# (droplet resize = short reboot, Mongo tier bump = maintenance window).
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
# (enable_dns = false). `domain` is still used to bake nginx's server_name and
# to drive Certbot on the droplet.
domain_root   = "smithfamily.agency"
dns_subdomain = "app"
domain        = "app.smithfamily.agency"

# TLS: nginx server_name is baked from `domain` on every build. Paired with the
# reserved IP below (stable across rebuilds) + DNS pointing at it, first-boot
# Certbot auto-issues on rebuilds.
#
# ⚠ Set this correctly on the FIRST apply. `user_data` cannot be changed in
#   place, so flipping this flag later REPLACES the droplet. On the very first
#   build Certbot will fail (DNS does not point here yet) — that is expected and
#   non-fatal, cloud-init wraps it. Finish with `sudo /opt/sfa/enable-tls.sh`
#   once the GoDaddy A record resolves.
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
enable_reserved_ip = true

# Provisions the Inngest droplet — the event bus, scheduler and executor for
# ALL asynchronous work, which in practice means every outbound email.
#
# ⚠ Load-bearing. Left unset it defaults to false, and the failure is silent:
#   no Inngest droplet, port 4000 never opened to it, deploy-inngest skipped,
#   and not one email delivered — while every health check stays green.
#   It must agree with the `INNGEST_ENABLED` GitHub Environment variable.
enable_inngest = true

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
