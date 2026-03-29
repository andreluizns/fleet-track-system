#!/usr/bin/env bash
# =============================================================================
# Fleet Track — Provisionamento de Topologia RabbitMQ
# =============================================================================
# Cria exchanges, filas e bindings via API HTTP do RabbitMQ Management Plugin.
#
# Topologia completa documentada em: contracts/rabbitmq-topology.jsonc
# Contrato de dados: contracts/gps-event.schema.json
#
# Uso:
#   RABBITMQ_USER=fleet_admin RABBITMQ_PASS=secret ./setup-rabbitmq.sh
#
# Variáveis de Ambiente:
#   RABBITMQ_USER       — Usuário admin (obrigatório)
#   RABBITMQ_PASS       — Senha admin (obrigatório)
#   RABBITMQ_HOST       — Hostname do broker (default: localhost)
#   RABBITMQ_MGMT_PORT  — Porta da Management API (default: 15672)
#   VHOST               — Virtual host (default: /)
#
# Idempotência: Erros HTTP 409 (Conflict) são ignorados silenciosamente.
#               Re-executar este script é seguro.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuração — lê de env vars com fallback para defaults
# ---------------------------------------------------------------------------
RABBITMQ_USER="${RABBITMQ_USER:-guest}"
RABBITMQ_PASS="${RABBITMQ_PASS:-guest}"
RABBITMQ_HOST="${RABBITMQ_HOST:-localhost}"
RABBITMQ_MGMT_PORT="${RABBITMQ_MGMT_PORT:-15672}"
VHOST="${VHOST:-%2F}"  # %2F = "/" URL-encoded

BASE_URL="http://${RABBITMQ_HOST}:${RABBITMQ_MGMT_PORT}/api"
AUTH="${RABBITMQ_USER}:${RABBITMQ_PASS}"

# Cores para output (facilita leitura nos logs de CI/CD)
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Funções Utilitárias
# ---------------------------------------------------------------------------

log_info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Executa um PUT na API RabbitMQ (exchanges e filas), ignorando conflito 409 (idempotência)
rabbitmq_put() {
  local description="$1"
  local endpoint="$2"
  local payload="$3"

  http_code=$(curl --silent --output /dev/null --write-out "%{http_code}" \
    --user "${AUTH}" \
    --request PUT \
    --header "Content-Type: application/json" \
    --data "${payload}" \
    "${BASE_URL}${endpoint}")

  if [[ "${http_code}" == "201" || "${http_code}" == "204" ]]; then
    log_info "Criado: ${description}"
  elif [[ "${http_code}" == "409" ]]; then
    log_warn "Já existe (409 ignorado - idempotente): ${description}"
  else
    log_error "Falha ao criar '${description}' — HTTP ${http_code}"
    log_error "  Endpoint: PUT ${BASE_URL}${endpoint}"
    log_error "  Payload:  ${payload}"
    return 1
  fi
}

# Executa um POST na API RabbitMQ (bindings), ignorando conflito 409 (idempotência)
# A API do RabbitMQ usa POST (não PUT) para criar bindings
rabbitmq_post() {
  local description="$1"
  local endpoint="$2"
  local payload="$3"

  http_code=$(curl --silent --output /dev/null --write-out "%{http_code}" \
    --user "${AUTH}" \
    --request POST \
    --header "Content-Type: application/json" \
    --data "${payload}" \
    "${BASE_URL}${endpoint}")

  if [[ "${http_code}" == "201" || "${http_code}" == "204" ]]; then
    log_info "Criado: ${description}"
  elif [[ "${http_code}" == "409" ]]; then
    log_warn "Já existe (409 ignorado - idempotente): ${description}"
  else
    log_error "Falha ao criar '${description}' — HTTP ${http_code}"
    log_error "  Endpoint: POST ${BASE_URL}${endpoint}"
    log_error "  Payload:  ${payload}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Aguarda RabbitMQ ficar disponível (retry loop)
# Conforme emergency-protocol.md: exponential backoff previne DoS no restart
# ---------------------------------------------------------------------------
wait_for_rabbitmq() {
  local max_attempts=30
  local sleep_seconds=2
  local attempt=1

  log_info "Aguardando RabbitMQ ficar disponível em ${RABBITMQ_HOST}:${RABBITMQ_MGMT_PORT}..."

  while [[ ${attempt} -le ${max_attempts} ]]; do
    http_code=$(curl --silent --output /dev/null --write-out "%{http_code}" \
      --user "${AUTH}" \
      --max-time 3 \
      "${BASE_URL}/overview" 2>/dev/null || echo "000")

    if [[ "${http_code}" == "200" ]]; then
      log_info "RabbitMQ disponivel após ${attempt} tentativa(s)."
      return 0
    fi

    log_warn "Tentativa ${attempt}/${max_attempts} — HTTP ${http_code}. Aguardando ${sleep_seconds}s..."
    sleep "${sleep_seconds}"
    ((attempt++))
  done

  log_error "RabbitMQ não ficou disponível após ${max_attempts} tentativas. Abortando."
  exit 1
}

# ---------------------------------------------------------------------------
# Main — Provisionamento da Topologia
# ---------------------------------------------------------------------------

echo "============================================================"
echo " Fleet Track — Setup de Topologia RabbitMQ"
echo " Host:  ${RABBITMQ_HOST}:${RABBITMQ_MGMT_PORT}"
echo " VHost: ${VHOST}"
echo "============================================================"

# Passo 1: Aguardar disponibilidade
wait_for_rabbitmq

echo ""
log_info "--- Criando Exchanges ---"

# ---------------------------------------------------------------------------
# Exchange Principal: tx.logistics.main
# Tipo: topic — permite routing por padrão (ex: "pinheirinho.gps.*")
# Padrão de routing key: {regiao}.{tipo_evento}.{severidade}
# ---------------------------------------------------------------------------
rabbitmq_put \
  "Exchange tx.logistics.main (topic)" \
  "/exchanges/${VHOST}/tx.logistics.main" \
  '{
    "type": "topic",
    "durable": true,
    "auto_delete": false,
    "internal": false,
    "arguments": {}
  }'

# ---------------------------------------------------------------------------
# Exchange Dead Letter: tx.logistics.dlx
# Tipo: direct — recebe mensagens rejeitadas (NACK requeue=false) ou expiradas (TTL)
# Routing key "#" da DLQ captura tudo via binding abaixo
# ---------------------------------------------------------------------------
rabbitmq_put \
  "Exchange tx.logistics.dlx (direct - Dead Letter)" \
  "/exchanges/${VHOST}/tx.logistics.dlx" \
  '{
    "type": "direct",
    "durable": true,
    "auto_delete": false,
    "internal": false,
    "arguments": {}
  }'

echo ""
log_info "--- Criando Filas ---"

# ---------------------------------------------------------------------------
# Fila: q.pinheirinho.gps.raw
# Consumidor: tracking-worker
# TTL: 5 minutos (300000ms) — coordenadas GPS antigas não têm valor operacional
# DLX: tx.logistics.dlx — mensagens expiradas/rejeitadas vão para dead-letter
# ---------------------------------------------------------------------------
rabbitmq_put \
  "Fila q.pinheirinho.gps.raw" \
  "/queues/${VHOST}/q.pinheirinho.gps.raw" \
  '{
    "durable": true,
    "auto_delete": false,
    "arguments": {
      "x-message-ttl": 300000,
      "x-dead-letter-exchange": "tx.logistics.dlx",
      "x-dead-letter-routing-key": "q.pinheirinho.gps.raw.dead"
    }
  }'

# ---------------------------------------------------------------------------
# Fila: q.pinheirinho.alert.geofence
# Consumidor: notification-service → WebSocket → Frontend
# TTL: 1 minuto (60000ms) — alertas geofence obsoletos devem expirar rapidamente
# DLX: tx.logistics.dlx — garante auditoria de alertas não processados
# ---------------------------------------------------------------------------
rabbitmq_put \
  "Fila q.pinheirinho.alert.geofence" \
  "/queues/${VHOST}/q.pinheirinho.alert.geofence" \
  '{
    "durable": true,
    "auto_delete": false,
    "arguments": {
      "x-message-ttl": 60000,
      "x-dead-letter-exchange": "tx.logistics.dlx",
      "x-dead-letter-routing-key": "q.pinheirinho.alert.geofence.dead"
    }
  }'

# ---------------------------------------------------------------------------
# Fila: q.logistics.dead-letter
# Consumidor: Sistema de monitoramento / Alertas DevOps
# Sem TTL — mensagens mortas devem ser retidas para análise
# Binding via DLX com routing key "#" captura todas as dead letters
# ---------------------------------------------------------------------------
rabbitmq_put \
  "Fila q.logistics.dead-letter" \
  "/queues/${VHOST}/q.logistics.dead-letter" \
  '{
    "durable": true,
    "auto_delete": false,
    "arguments": {}
  }'

echo ""
log_info "--- Criando Bindings ---"

# ---------------------------------------------------------------------------
# Binding: q.pinheirinho.gps.raw → tx.logistics.main
# Routing key: "pinheirinho.gps.raw"
# Origem: API de Ingestão publica com esta chave após validar GpsEvent v1.0.0
# ---------------------------------------------------------------------------
rabbitmq_post \
  "Binding q.pinheirinho.gps.raw → tx.logistics.main (pinheirinho.gps.raw)" \
  "/bindings/${VHOST}/e/tx.logistics.main/q/q.pinheirinho.gps.raw" \
  '{
    "routing_key": "pinheirinho.gps.raw",
    "arguments": {}
  }'

# ---------------------------------------------------------------------------
# Binding: q.pinheirinho.alert.geofence → tx.logistics.main
# Routing key: "pinheirinho.alert.geofence"
# Origem: tracking-worker publica quando ST_Within(geofence) = true
# ---------------------------------------------------------------------------
rabbitmq_post \
  "Binding q.pinheirinho.alert.geofence → tx.logistics.main (pinheirinho.alert.geofence)" \
  "/bindings/${VHOST}/e/tx.logistics.main/q/q.pinheirinho.alert.geofence" \
  '{
    "routing_key": "pinheirinho.alert.geofence",
    "arguments": {}
  }'

# ---------------------------------------------------------------------------
# Binding: q.logistics.dead-letter → tx.logistics.dlx
# Routing key: "#" — captura qualquer chave roteada para a DLX
# Mensagens chegam aqui via: NACK(requeue=false) ou TTL expirado nas filas acima
# ---------------------------------------------------------------------------
rabbitmq_post \
  "Binding q.logistics.dead-letter → tx.logistics.dlx (# wildcard)" \
  "/bindings/${VHOST}/e/tx.logistics.dlx/q/q.logistics.dead-letter" \
  '{
    "routing_key": "#",
    "arguments": {}
  }'

echo ""
echo "============================================================"
log_info "Topologia RabbitMQ provisionada com sucesso!"
echo ""
log_info "Exchanges criadas:"
log_info "  - tx.logistics.main  (topic)"
log_info "  - tx.logistics.dlx   (direct - Dead Letter)"
echo ""
log_info "Filas criadas:"
log_info "  - q.pinheirinho.gps.raw         (TTL: 5min)"
log_info "  - q.pinheirinho.alert.geofence  (TTL: 1min)"
log_info "  - q.logistics.dead-letter       (sem TTL)"
echo ""
log_info "Management UI: http://${RABBITMQ_HOST}:${RABBITMQ_MGMT_PORT}"
echo "============================================================"
