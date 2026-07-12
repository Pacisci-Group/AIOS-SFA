#!/usr/bin/env bash
#
# create-env.sh <environment>
#
# Spins up a new environment (staging, production, or any custom name) from the
# golden _template plus a matching presets/<env>.tfvars file. This is the
# "one command away" path referenced in the deployment plan.
#
# Requirements (env vars):
#   DIGITALOCEAN_TOKEN        DO API token
#   TF_STATE_BUCKET           Spaces bucket holding remote state
#   TF_STATE_REGION           Spaces region (e.g. nyc3)
#   AWS_ACCESS_KEY_ID         Spaces access key (for the s3 backend)
#   AWS_SECRET_ACCESS_KEY     Spaces secret key
#
set -euo pipefail

ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: $0 <environment>   (e.g. staging, production)" >&2
  exit 1
fi

if [[ "$ENV_NAME" == "_template" || "$ENV_NAME" == "presets" ]]; then
  echo "Refusing to use reserved name: $ENV_NAME" >&2
  exit 1
fi

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="$TF_DIR/environments/_template"
PRESET_FILE="$TF_DIR/environments/presets/${ENV_NAME}.tfvars"
TARGET_DIR="$TF_DIR/environments/${ENV_NAME}"

: "${TF_STATE_BUCKET:?Set TF_STATE_BUCKET}"
: "${TF_STATE_REGION:?Set TF_STATE_REGION}"

if [[ ! -f "$PRESET_FILE" ]]; then
  echo "No preset found at $PRESET_FILE" >&2
  echo "Create it (copy an existing preset) before running." >&2
  exit 1
fi

if [[ -d "$TARGET_DIR" ]]; then
  echo "Environment '$ENV_NAME' already exists at $TARGET_DIR." >&2
  echo "To apply changes: make apply ENV=$ENV_NAME" >&2
  exit 1
fi

echo "==> Creating environment: $ENV_NAME"
mkdir -p "$TARGET_DIR"
cp "$TEMPLATE_DIR/main.tf" "$TARGET_DIR/main.tf"
cp "$TEMPLATE_DIR/variables.tf" "$TARGET_DIR/variables.tf"
cp "$TEMPLATE_DIR/outputs.tf" "$TARGET_DIR/outputs.tf"
cp "$PRESET_FILE" "$TARGET_DIR/terraform.tfvars"

# Render backend.tf from template with substitutions.
sed \
  -e "s|{{ENV}}|${ENV_NAME}|g" \
  -e "s|{{STATE_BUCKET}}|${TF_STATE_BUCKET}|g" \
  -e "s|{{SPACES_REGION}}|${TF_STATE_REGION}|g" \
  "$TEMPLATE_DIR/backend.tf.tpl" > "$TARGET_DIR/backend.tf"

echo "==> terraform init"
terraform -chdir="$TARGET_DIR" init -input=false

echo "==> terraform apply"
terraform -chdir="$TARGET_DIR" apply -input=false -var-file=terraform.tfvars

echo ""
echo "Environment '$ENV_NAME' created."
echo "Next: configure app secrets + deploy. See infra/terraform/README.md."
