/**
 * Where an autoscale pool gets its configuration.
 *
 * ## Why this exists
 * The old deploy model was `scp` a compose file and `ssh` a restart. That
 * cannot work for a pool: a droplet created during a traffic spike at 3am has
 * to come up already configured, and nothing was there to SSH to it. So the
 * deploy publishes here instead, and every droplet — the ones running now and
 * the ones created later — converges on the same object by the same path.
 *
 * ## A separate bucket from the uploads one, on purpose
 * The object stored here carries the application's entire environment: database
 * URI, JWT secrets, the certificate encryption key. The uploads bucket holds
 * tenant documents and is reachable with a key the app itself carries. Keeping
 * them apart means the credential that reads deploy config cannot read a
 * client's files, and the credential the app uses every day cannot read the
 * platform's secrets.
 */
resource "digitalocean_spaces_bucket" "config" {
  name   = var.name
  region = var.region

  # Private. There is no public-read case for this bucket, and the object in it
  # is the most sensitive thing the platform has.
  acl = "private"

  versioning {
    # A bad deploy is recoverable by reading back the previous version, which is
    # the closest thing a pool has to "roll back the config".
    enabled = true
  }
}

/**
 * The credential droplets bootstrap with.
 *
 * ⚠ Read-only, and that is load-bearing. It is passed through `user_data`,
 * which anything on the droplet can read from the metadata service — so treat
 * it as known to every process on the box. Read-only means a compromised
 * droplet cannot rewrite the configuration every *other* droplet is about to
 * fetch, which would otherwise be a one-step path from one node to all of them.
 */
resource "digitalocean_spaces_key" "bootstrap" {
  name = "${var.name}-bootstrap"

  grant {
    bucket     = digitalocean_spaces_bucket.config.name
    permission = "read"
  }
}

/**
 * The credential CI publishes with. Never present on a droplet.
 */
resource "digitalocean_spaces_key" "publish" {
  name = "${var.name}-publish"

  grant {
    bucket     = digitalocean_spaces_bucket.config.name
    permission = "readwrite"
  }
}
