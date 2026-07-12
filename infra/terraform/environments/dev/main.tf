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
  # Token from DIGITALOCEAN_TOKEN env var
}

module "sfa" {
  source = "../../stacks/sfa"

  environment        = var.environment
  region             = var.region
  spaces_region      = var.spaces_region
  droplet_size       = var.droplet_size
  mongo_size         = var.mongo_size
  mongo_node_count   = var.mongo_node_count
  domain_root        = var.domain_root
  dns_subdomain      = var.dns_subdomain
  domain             = var.domain
  ssh_public_key     = var.ssh_public_key
  ssh_allowed_ips    = var.ssh_allowed_ips
  enable_dns         = var.enable_dns
  create_domain_zone = var.create_domain_zone
  enable_reserved_ip = var.enable_reserved_ip
  enable_spaces      = var.enable_spaces
  enable_backups     = var.enable_backups
  prevent_destroy    = var.prevent_destroy
  project_id         = var.project_id
  tags               = var.tags
}
