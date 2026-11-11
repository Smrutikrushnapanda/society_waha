# Render linux/amd64 runtime for WAHA 2026.9.2 CORE (WEBJS)
# Base digest matches linux/amd64 manifest of devlikeapro/waha:latest-2026.9.2
FROM devlikeapro/waha@sha256:280bdc8f860267a2488a45d00ec88529646f7468c0bf0283c595d6efdd1b5e3b

COPY --chmod=0555 scripts /opt/societyos-waha

ENV WHATSAPP_DEFAULT_ENGINE=WEBJS \
    WAHA_NAMESPACE=all \
    WAHA_SESSION_NAME=session_01m5amp8ak239hr4cs57ydvaqm \
    WAHA_WORKER_RESTART_SESSIONS=true \
    WAHA_PRINT_QR=False \
    WAHA_LOG_FORMAT=JSON \
    WAHA_LOG_LEVEL=info \
    WAHA_MEDIA_STORAGE=POSTGRESQL \
    WAHA_DASHBOARD_ENABLED=true \
    WHATSAPP_SWAGGER_ENABLED=false \
    SOCIETYOS_WAHA_POSTGRES_GUARD=true \
    NODE_OPTIONS="--max-old-space-size=16384 --require=/opt/societyos-waha/postgres-tls.cjs"

HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=3 \
  CMD ["node", "/opt/societyos-waha/healthcheck.cjs"]
