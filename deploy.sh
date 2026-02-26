#!/bin/bash
# Deploy script for Google Cloud Run
# Usage: ./deploy.sh [project-id]

set -e

PROJECT_ID="${1:-your-gcp-project-id}"
REGION="us-central1"
BACKEND_SERVICE="mathboard-backend"
FRONTEND_SERVICE="mathboard-frontend"

echo "🚀 Deploying MathBoard to Google Cloud Run..."
echo "   Project: $PROJECT_ID"
echo "   Region: $REGION"

# Deploy backend
echo ""
echo "📦 Building & deploying backend..."
cd backend
gcloud builds submit --tag "gcr.io/$PROJECT_ID/$BACKEND_SERVICE" --project "$PROJECT_ID"
gcloud run deploy "$BACKEND_SERVICE" \
  --image "gcr.io/$PROJECT_ID/$BACKEND_SERVICE" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=\$GOOGLE_API_KEY,GCP_PROJECT_ID=$PROJECT_ID" \
  --project "$PROJECT_ID"

BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE" --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')
echo "✅ Backend deployed: $BACKEND_URL"

# Deploy frontend
echo ""
echo "📦 Building & deploying frontend..."
cd ../frontend
gcloud builds submit --tag "gcr.io/$PROJECT_ID/$FRONTEND_SERVICE" --project "$PROJECT_ID"
gcloud run deploy "$FRONTEND_SERVICE" \
  --image "gcr.io/$PROJECT_ID/$FRONTEND_SERVICE" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "NEXT_PUBLIC_WS_URL=${BACKEND_URL/https/wss}/ws/session,NEXT_PUBLIC_API_URL=$BACKEND_URL" \
  --project "$PROJECT_ID"

FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SERVICE" --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')
echo ""
echo "✅ MathBoard deployed!"
echo "   Frontend: $FRONTEND_URL"
echo "   Backend:  $BACKEND_URL"
