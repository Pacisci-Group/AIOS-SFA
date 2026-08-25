resource "digitalocean_spaces_bucket" "this" {
  name   = var.name
  region = var.region
  acl    = var.acl

  versioning {
    enabled = var.versioning_enabled
  }
}

# Browser CORS rules for the bucket.
#
# Uploads are presigned PUTs: the API signs a URL and the *browser* sends the
# bytes straight here, so the request never passes through our own origin. With
# no rule matching the web app's origin the preflight fails and every upload
# dies client-side — while the API stays green, because it only ever issued a
# URL. That silent split is why this is provisioned rather than left as a
# console step.
resource "digitalocean_spaces_bucket_cors_configuration" "this" {
  count = length(var.cors_allowed_origins) > 0 ? 1 : 0

  bucket = digitalocean_spaces_bucket.this.id
  region = var.region

  cors_rule {
    # The presign signs `Content-Type`, and the browser has to be allowed to
    # send it back on the PUT or the signature will not match.
    allowed_headers = ["*"]
    # PUT for uploads, GET/HEAD for presigned downloads and existence checks.
    allowed_methods = ["GET", "HEAD", "PUT"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = var.cors_max_age_seconds
  }
}

# Application credentials for STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY.
#
# Scoped to this bucket with `readwrite` rather than reusing an account-wide
# Spaces key, so a leaked application credential cannot reach the Terraform
# state bucket or another environment's files. Note that `readwrite` does not
# include bucket creation — deliberately: StorageService's CreateBucket fallback
# is a local-MinIO convenience and must never be what provisions cloud storage.
resource "digitalocean_spaces_key" "app" {
  count = var.create_access_key ? 1 : 0

  name = "${var.name}-app"

  grant {
    bucket     = digitalocean_spaces_bucket.this.name
    permission = "readwrite"
  }
}
