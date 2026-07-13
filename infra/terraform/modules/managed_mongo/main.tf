resource "digitalocean_database_cluster" "this" {
  name       = var.name
  engine     = "mongodb"
  version    = var.engine_version
  size       = var.size
  region     = var.region
  node_count = var.node_count
}

resource "digitalocean_database_db" "app" {
  cluster_id = digitalocean_database_cluster.this.id
  name       = var.database_name
}

resource "digitalocean_database_user" "app" {
  cluster_id = digitalocean_database_cluster.this.id
  name       = var.db_user_name

  # MongoDB users have no configurable "settings" (that block is for Kafka/MySQL/
  # OpenSearch). Older provider versions can leave a phantom empty settings{} in
  # state; removing it triggers a DO API 400 ("missing required field:
  # user_settings"). Ignore it so applies converge cleanly.
  lifecycle {
    ignore_changes = [settings]
  }
}

resource "digitalocean_database_firewall" "this" {
  cluster_id = digitalocean_database_cluster.this.id

  dynamic "rule" {
    for_each = var.allowed_droplet_ids
    content {
      type  = "droplet"
      value = rule.value
    }
  }
}

# Note: backup policy for MongoDB on DO is typically tied to cluster tier/plan.
# enable_backups is exposed for documentation; upgrade size/tier for production backups.
