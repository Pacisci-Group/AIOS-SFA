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
  # Token from DIGITALOCEAN_TOKEN.
  # Spaces access via SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY,
  # or spaces_access_id / spaces_secret_key below.
  spaces_access_id  = var.spaces_access_id
  spaces_secret_key = var.spaces_secret_key
}

# Remote state bucket for all environments.
# This bucket itself is created with LOCAL state (chicken-and-egg), so keep
# bootstrap/terraform.tfstate committed-free but safe (it only tracks the bucket).
resource "digitalocean_spaces_bucket" "state" {
  name   = var.state_bucket_name
  region = var.region
  acl    = "private"

  versioning {
    enabled = true
  }
}
