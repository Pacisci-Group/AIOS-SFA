# Managed Valkey (the Redis-compatible engine DigitalOcean now provisions;
# `engine = "redis"` is retired for new clusters). One per environment, for
# everything in the app that speaks Redis: today the permission cache and the
# notification pub/sub fan-out (PAC-154).
#
# ⚠ Setting REDIS_URL on the app switches BOTH on. The permission cache was
# dormant in production until this cluster existed; it is a safety-TTL'd cache
# that fails open, so that is accepted, but it is why this cluster's first
# apply is also a change to how permissions are resolved.
resource "digitalocean_database_cluster" "this" {
  name       = var.name
  engine     = "valkey"
  version    = var.engine_version
  size       = var.size
  region     = var.region
  node_count = var.node_count

  # Nothing durable lives here. The permission cache carries a TTL and the
  # pub/sub channel stores nothing, so when memory fills the right answer is
  # to drop the least recently used cache entry — never to refuse writes,
  # which `noeviction` would do and which would surface as 500s on every
  # request that tried to warm the cache.
  eviction_policy = "allkeys_lru"

  # Same VPC as the droplets, so `private_uri` resolves to an address they can
  # reach without leaving the network. Left unset the cluster lands in the
  # region's default VPC, which is not the one this environment created.
  private_network_uuid = var.private_network_uuid
}

// This resource owns the cluster's ENTIRE allow-list — the DO API replaces the
// rule set wholesale on every apply. Anything added by hand in the DO console is
// therefore deleted on the next apply, silently, as a side effect of unrelated
// work. Same shape, same reasons, as the MongoDB module's.
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

  // Droplets admitted by TAG rather than by id: an autoscale pool's members
  // are not knowable at plan time. See the MongoDB module for the failure
  // this prevents — one freshly scaled node refused by the store while its
  // siblings are fine.
  dynamic "rule" {
    for_each = var.allowed_tags
    content {
      type  = "tag"
      value = rule.value
    }
  }
}
