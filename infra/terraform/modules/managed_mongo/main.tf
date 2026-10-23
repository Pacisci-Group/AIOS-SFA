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

// This resource owns the cluster's ENTIRE allow-list — the DO API replaces the
// rule set wholesale on every apply. Anything added by hand in the DO console is
// therefore deleted on the next apply, silently, as a side effect of unrelated
// work. Both rule sources below exist so that access can be expressed here
// instead of out-of-band.
resource "digitalocean_database_firewall" "this" {
  cluster_id = digitalocean_database_cluster.this.id

  dynamic "rule" {
    for_each = var.allowed_droplet_ids
    content {
      type  = "droplet"
      value = rule.value
    }
  }

  dynamic "rule" {
    for_each = var.allowed_ip_addresses
    content {
      type  = "ip_addr"
      value = rule.value
    }
  }

  // Droplets admitted by TAG rather than by id.
  //
  // Required once the app tier is an autoscale pool: a droplet created ten
  // minutes after the last apply has an id terraform has never seen, so an
  // id-based rule would lock out exactly the droplets that scaling created —
  // and the symptom is a node that serves every page as a 500 while its
  // siblings are fine.
  dynamic "rule" {
    for_each = var.allowed_tags
    content {
      type  = "tag"
      value = rule.value
    }
  }
}

# Backups: DigitalOcean takes a daily backup of every managed MongoDB cluster and
# keeps seven days of point-in-time recovery, whatever its size - there is no
# setting here because there is nothing to switch on. Two properties of those
# backups matter more than their existence:
#
#   - Restoring never rewinds this cluster. It forks a NEW one
#     (`doctl databases fork ... --restore-from-cluster-id ... --restore-from-timestamp ...`),
#     so the connection string and this firewall have to follow it.
#   - Destroying the cluster destroys its backups.
#
# The second is why the stack's `enable_db_backups` ships a weekly copy to a
# bucket this cluster's lifecycle cannot touch (PAC-172). See DEPLOYMENT.md,
# "Database backups", for both restore paths.
