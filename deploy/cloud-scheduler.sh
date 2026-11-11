#!/usr/bin/env bash
# Creates (or updates) the Cloud Scheduler jobs for Sales & Marketing Tools.
# Times are in WIB (Asia/Jakarta). Every job calls GET <APP_URL>/api/cron/<job>
# with the header "Authorization: Bearer <CRON_SECRET>".
#
#   PROJECT=boemi-prod REGION=asia-southeast2 APP_URL=https://tools.boemibotanicals.com \
#   CRON_SECRET="$(gcloud secrets versions access latest --secret=CRON_SECRET)" \
#   bash deploy/cloud-scheduler.sh
set -euo pipefail
: "${PROJECT:?set PROJECT}" "${REGION:?set REGION (e.g. asia-southeast2)}" "${APP_URL:?set APP_URL}" "${CRON_SECRET:?set CRON_SECRET}"

# name | schedule (cron, WIB) | what it does
JOBS=(
  "task-reminders|0 7 * * *|Task due within 24h / overdue reminders (07:00)"
  "pending-visit-fees|0 8 * * *|Remind approvers of requests waiting > 24h (08:00)"
  "daily-digest|30 6 * * *|Daily summary for executives and department heads (06:30)"
  "expire-quotations|5 0 * * *|Sent quotations past valid-until → expired (00:05)"
  "qualification-queue|*/5 * * * *|Lead/account scoring queue + AI retries (every 5 min)"
  "lead-sla|10 8-20 * * *|Leads past their contact SLA → owner, then manager (hourly 08:10–20:10)"
)

for row in "${JOBS[@]}"; do
  IFS="|" read -r name schedule description <<<"$row"
  args=(
    --project="$PROJECT" --location="$REGION"
    --schedule="$schedule" --time-zone="Asia/Jakarta"
    --uri="${APP_URL%/}/api/cron/${name}" --http-method=GET
    --update-headers="Authorization=Bearer ${CRON_SECRET}"
    --attempt-deadline=300s --description="$description"
  )
  if gcloud scheduler jobs describe "smt-${name}" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "smt-${name}" "${args[@]}"
  else
    # "create" takes --headers instead of --update-headers.
    gcloud scheduler jobs create http "smt-${name}" "${args[@]/--update-headers=/--headers=}"
  fi
  echo "✓ smt-${name}  ${schedule} WIB"
done
