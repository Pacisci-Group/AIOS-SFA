locals {
  name_prefix = "sfa-${var.environment}"
  all_tags    = concat(["sfa", var.environment], var.tags)
}

resource "digitalocean_ssh_key" "deploy" {
  name       = "${local.name_prefix}-deploy"
  public_key = var.ssh_public_key
}

module "vpc" {
  source = "../../modules/vpc"

  name   = "${local.name_prefix}-vpc"
  region = var.region
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

  user_data = templatefile("${path.module}/../../modules/droplet/templates/cloud-init.yaml.tpl", {
    ssh_public_key = var.ssh_public_key
    domain         = var.domain
    enable_tls     = var.enable_tls
    certbot_email  = var.certbot_email
  })
}

module "firewall" {
  source = "../../modules/firewall"

  name             = "${local.name_prefix}-fw"
  droplet_ids      = [module.droplet.id]
  ssh_allowed_ips  = var.ssh_allowed_ips
  allow_http_https = true
}

module "mongo" {
  source = "../../modules/managed_mongo"

  name                = "${local.name_prefix}-mongo"
  region              = var.region
  size                = var.mongo_size
  node_count          = var.mongo_node_count
  allowed_droplet_ids = [module.droplet.id]
  enable_backups      = var.enable_backups
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

  name   = "${local.name_prefix}-files"
  region = var.spaces_region
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
    var.enable_spaces ? [module.spaces[0].urn] : [],
  )
}
