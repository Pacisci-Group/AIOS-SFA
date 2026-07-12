#!/usr/bin/env bash
#
# destroy-env.sh <environment>
#
# Tears down a non-production environment. Production is blocked by default
# (prevent_destroy on critical resources + explicit guard here).
#
set -euo pipefail

ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: $0 <environment>" >&2
  exit 1
fi

if [[ "$ENV_NAME" == "production" ]]; then
  echo "Refusing to destroy production via script." >&2
  echo "If you really mean it, run terraform destroy manually after removing prevent_destroy." >&2
  exit 1
fi

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$TF_DIR/environments/${ENV_NAME}"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Environment '$ENV_NAME' does not exist at $TARGET_DIR." >&2
  exit 1
fi

echo "==> Destroying environment: $ENV_NAME"
terraform -chdir="$TARGET_DIR" destroy -input=false -var-file=terraform.tfvars

echo "Destroyed '$ENV_NAME'. Local env folder left in place (delete manually if desired)."
