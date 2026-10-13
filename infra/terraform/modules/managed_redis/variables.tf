variable "name" {
  description = "Valkey cluster name"
  type        = string
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
}

variable "size" {
  description = "Database size slug"
  type        = string
}

variable "node_count" {
  description = "Number of nodes. One is enough: nothing durable lives here."
  type        = number
  default     = 1
}

variable "engine_version" {
  description = "Valkey major version"
  type        = string
  default     = "8"
}

variable "private_network_uuid" {
  description = "The VPC the cluster joins — the environment's, so the droplets reach it over `private_uri`."
  type        = string
}

variable "allowed_droplet_ids" {
  description = "Droplet IDs allowed to connect"
  type        = list(string)
  default     = []
}

variable "allowed_ip_addresses" {
  description = <<-EOT
    Individual IPs or CIDRs allowed to connect, for a developer reaching the
    cluster directly (redis-cli, a pub/sub probe).

    The application does NOT need an entry here — it connects from the droplet
    and is covered by `allowed_droplet_ids` / `allowed_tags`.

    Declare access here rather than in the DigitalOcean console: the firewall
    resource owns the whole rule set, so a console-added rule is deleted by the
    next apply. Keep it short and comment who each entry belongs to.
  EOT

  type    = list(string)
  default = []
}

variable "allowed_tags" {
  description = <<-EOT
    Droplet tags allowed to reach the cluster.

    The autoscale pool is admitted this way: its members' ids are not knowable
    at plan time and change as the pool scales, so only a tag can name "whatever
    is currently in the pool".
  EOT
  type        = list(string)
  default     = []
}
