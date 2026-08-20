terraform {
  required_version = ">= 1.5.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.34"
    }
  }
}

provider "digitalocean" {
  # API token from DIGITALOCEAN_TOKEN.
  #
  # Spaces *buckets* are managed over the S3 API, not the DO API, so creating or
  # changing the uploads bucket (enable_spaces = true) additionally needs
  # SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY exported — the same
  # account-level Spaces key used for the remote state backend. Without them the
  # plan fails on the bucket and CORS resources with a credentials error.
}

module "sfa" {
  source = "../../stacks/sfa"

  environment                = var.environment
  region                     = var.region
  spaces_region              = var.spaces_region
  droplet_size               = var.droplet_size
  mongo_size                 = var.mongo_size
  mongo_node_count           = var.mongo_node_count
  mongo_allowed_ip_addresses = var.mongo_allowed_ip_addresses
  domain_root                = var.domain_root
  dns_subdomain              = var.dns_subdomain
  domain                     = var.domain
  enable_tls                 = var.enable_tls
  certbot_email              = var.certbot_email
  ssh_public_key             = var.ssh_public_key
  ssh_allowed_ips            = var.ssh_allowed_ips
  enable_dns                 = var.enable_dns
  create_domain_zone         = var.create_domain_zone
  enable_reserved_ip         = var.enable_reserved_ip
  enable_spaces              = var.enable_spaces
  spaces_cors_origins        = var.spaces_cors_origins
  create_spaces_access_key   = var.create_spaces_access_key
  enable_inngest             = var.enable_inngest
  inngest_droplet_size       = var.inngest_droplet_size
  enable_backups             = var.enable_backups
  prevent_destroy            = var.prevent_destroy
  project_id                 = var.project_id
  tags                       = var.tags
}
