/**
 * Where the worker writes its MongoDB snapshots (PAC-172).
 *
 * ## Why this exists alongside DigitalOcean's own backups
 * The managed cluster is backed up daily with seven days of point-in-time
 * recovery, but those backups belong to the cluster: destroying it destroys
 * them, and nothing older than a week exists. This bucket is the copy the
 * cluster's lifecycle cannot touch.
 *
 * ## A separate bucket from the uploads one, on purpose
 * An archive here is every tenant's data in one file. The uploads bucket is
 * reachable with a key the app carries on every request path, and the deploy
 * config bucket holds the platform's secrets. Each of the three keys is granted
 * its own bucket alone, so none can read another's.
 *
 * ⚠ That is about the grants, not about who holds the keys. The worker's key
 * here travels in the shared app.env — every container that loads it, and the
 * deploy-config object it is published as — so those can reach the archives
 * until it is scoped to the worker (DEPLOYMENT.md, "Database backups").
 */
resource "digitalocean_spaces_bucket" "backups" {
  name   = var.name
  region = var.region

  # Private. Nothing ever reads an archive from a browser, so there is also no
  # CORS configuration for this bucket.
  acl = "private"

  versioning {
    # Off, deliberately. The worker keeps one weekly archive per schedule week
    # for the newest DB_BACKUP_KEEP weeks and deletes the rest, and that has to
    # mean what it says: with
    # versioning on, every delete would leave a noncurrent copy behind, doubling
    # what is stored and silently defeating the retention the report mail states.
    enabled = false
  }

  # Snapshots requested by hand or by a deploy are not rotated by the worker -
  # only the scheduled ones are - so the bucket ages these out instead.
  #
  # There is no rule for weekly/: the worker keeps one archive per schedule week
  # for the newest DB_BACKUP_KEEP weeks and deletes the rest itself, and the
  # provider requires an expiration on every rule, so one cannot be
  # added just to abort stale multipart uploads (the worker uploads with a
  # single PUT, so it leaves none).
  lifecycle_rule {
    id      = "expire-manual"
    prefix  = "manual/"
    enabled = true

    abort_incomplete_multipart_upload_days = 1

    expiration {
      days = var.adhoc_retention_days
    }
  }

  lifecycle_rule {
    id      = "expire-pre-deploy"
    prefix  = "pre-deploy/"
    enabled = true

    abort_incomplete_multipart_upload_days = 1

    expiration {
      days = var.adhoc_retention_days
    }
  }
}

/**
 * The credential the worker snapshots with: DB_BACKUP_STORAGE_ACCESS_KEY_ID /
 * DB_BACKUP_STORAGE_SECRET_ACCESS_KEY.
 *
 * Read/write because rotation deletes. Scoped to this bucket alone, so it cannot
 * reach the uploads, the deploy config or the Terraform state.
 */
resource "digitalocean_spaces_key" "worker" {
  name = "${var.name}-worker"

  grant {
    bucket     = digitalocean_spaces_bucket.backups.name
    permission = "readwrite"
  }
}
