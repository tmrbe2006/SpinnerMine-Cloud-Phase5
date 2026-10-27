#!/bin/bash
# ==============================================================================
# SpinnerMine Cloud — Google Cloud Run Production Deployment Script
# Targets: spinnermine-cloud-production | Firestore: (default)
# ==============================================================================
set -euo pipefail

PROJECT_ID="spinnermine-cloud-production"
REGION="europe-west1"
SERVICE_NAME="spinnermine-backend"

echo "================================================================="
echo "SpinnerMine Cloud: Deploying Backend to Cloud Run"
echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Service:  ${SERVICE_NAME}"
echo "================================================================="

# 1. Set Google Cloud Project
echo "[1/4] Setting GCP project to ${PROJECT_ID}..."
gcloud config set project "${PROJECT_ID}"

# 2. Ensure Required APIs are enabled
echo "[2/4] Verifying required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com

# 3. Grant IAM Permissions to Cloud Run Default Compute Service Account
# Project Number: 157443993763
COMPUTE_SA="157443993763-compute@developer.gserviceaccount.com"
echo "[3/4] Granting Cloud Datastore User (roles/datastore.user) to ${COMPUTE_SA}..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/datastore.user" || true

# 4. Deploy to Cloud Run
echo "[4/4] Building and deploying container to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --source="." \
  --platform="managed" \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=${PROJECT_ID},NODE_ENV=production"

# Retrieve Deployed Service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --platform=managed --region="${REGION}" --format="value(status.url)")

echo "================================================================="
echo "SUCCESS: Cloud Run backend is live!"
echo "Production Backend URL: ${SERVICE_URL}"
echo "Health Check Endpoint:  ${SERVICE_URL}/api/health"
echo "================================================================="
echo "Copy this URL into your Electron app's Cloud Diagnostics screen"
echo "or set VITE_BACKEND_API_URL=${SERVICE_URL} for building the Windows installer."
echo "================================================================="
