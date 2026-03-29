#!/usr/bin/env bash
# =============================================================================
# Fleet Track — Configuração de Firewall UFW (Linux)
# =============================================================================
# Script de hardening de rede para o servidor de produção/staging.
# Aplica o princípio de menor privilégio: nega tudo por padrão, libera apenas
# o necessário para o funcionamento do Fleet Track.
#
# Referência de segurança: .agents/devops.md (Prioridades Técnicas #2)
# Stack: Docker (Dev), Kubernetes (Prod) — regras UFW protegem o host.
#
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
# AVISO CRÍTICO — LEIA ANTES DE EXECUTAR EM PRODUÇÃO:
#
#   1. Revise os IPs permitidos para portas sensíveis (5432, 5672, 15672)
#      antes de habilitar o UFW. Deixar essas portas abertas para 0.0.0.0/0
#      expõe o banco de dados e o broker à internet pública.
#
#   2. Substitua os comentários "# PROD: restringir por IP" pelas regras:
#      ufw allow from <SEU_IP_ESCRITORIO> to any port <PORTA>
#      ufw allow from <IP_SERVIDOR_APP> to any port <PORTA>
#
#   3. Certifique-se de que sua sessão SSH está estável antes de executar.
#      Uma regra errada pode bloquear seu acesso ao servidor.
#
#   4. Para reverter: ufw disable && ufw reset
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
#
# Uso (requer sudo):
#   sudo bash ufw-setup.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Verificação de permissões
# ---------------------------------------------------------------------------
if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERROR] Este script deve ser executado como root (sudo)."
  echo "        Uso: sudo bash ufw-setup.sh"
  exit 1
fi

echo "============================================================"
echo " Fleet Track — Setup UFW Firewall"
echo " Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""
echo "[AVISO] Revise as regras de IP antes de prosseguir em produção!"
echo ""

# ---------------------------------------------------------------------------
# Política padrão: DENY tudo que entra, ALLOW tudo que sai
# Princípio de menor privilégio: bloqueie por padrão, abra apenas o necessário
# ---------------------------------------------------------------------------
echo "[INFO] Configurando políticas padrão..."
ufw default deny incoming
ufw default allow outgoing

# ---------------------------------------------------------------------------
# SSH — Porta 22
# CRÍTICO: Esta regra DEVE ser criada ANTES de habilitar o UFW.
# Sem ela, você pode perder acesso remoto ao servidor.
# ---------------------------------------------------------------------------
echo "[INFO] Liberando SSH (porta 22)..."
ufw allow ssh
# Alternativa mais segura se SSH estiver em porta customizada:
# ufw allow <PORTA_SSH>/tcp

# ---------------------------------------------------------------------------
# RabbitMQ AMQP — Porta 5672
# Utilizado pela API de Ingestão e pelo tracking-worker para pub/sub de mensagens.
#
# PROD: Restringir por IP do servidor de aplicação. Exemplo:
#   ufw allow from 10.0.0.5 to any port 5672 proto tcp  # IP do servidor API
#   ufw allow from 10.0.0.6 to any port 5672 proto tcp  # IP do tracking-worker
#
# NÃO expor para 0.0.0.0 em produção: o broker não deve ser acessível pela internet.
# ---------------------------------------------------------------------------
echo "[INFO] Liberando RabbitMQ AMQP (porta 5672)..."
echo "[AVISO] Em producao, substitua por: ufw allow from <IP_APP> to any port 5672"
ufw allow 5672/tcp

# ---------------------------------------------------------------------------
# RabbitMQ Management UI — Porta 15672
# Interface web para monitoramento de filas, exchanges e mensagens.
#
# PROD: Restringir ao IP do time DevOps/interno. NUNCA expor para internet.
#   ufw allow from <IP_DEVOPS_VPN> to any port 15672 proto tcp
#
# Esta porta expõe credenciais de admin do broker se acessível publicamente.
# ---------------------------------------------------------------------------
echo "[INFO] Liberando RabbitMQ Management UI (porta 15672)..."
echo "[AVISO] Em producao, substitua por: ufw allow from <IP_DEVOPS> to any port 15672"
ufw allow 15672/tcp

# ---------------------------------------------------------------------------
# PostgreSQL / PostGIS — Porta 5432
# Banco de dados geoespacial. Armazena gps_events e geofences do Pinheirinho.
#
# PROD: Restringir ao IP do servidor de aplicação. Banco de dados NUNCA deve
#       ser acessível diretamente pela internet.
#   ufw allow from <IP_APP_SERVER> to any port 5432 proto tcp
#
# Para desenvolvimento local com Docker, o postgres só escuta internamente
# via fleet_network — esta regra cobre acesso direto ao host (ex: DBeaver local).
# ---------------------------------------------------------------------------
echo "[INFO] Liberando PostgreSQL (porta 5432)..."
echo "[AVISO] Em producao, substitua por: ufw allow from <IP_APP> to any port 5432"
ufw allow 5432/tcp

# ---------------------------------------------------------------------------
# API de Ingestão GPS — Porta 3000
# Endpoint HTTP: POST /api/v1/gps — recebe telemetria dos dispositivos GPS.
# Deve ser acessível pelos dispositivos GPS (podem estar em IPs dinâmicos).
# Se os dispositivos tiverem IPs fixos, restringir por IP também aqui.
# ---------------------------------------------------------------------------
echo "[INFO] Liberando API de Ingestao GPS (porta 3000)..."
ufw allow 3000/tcp

# ---------------------------------------------------------------------------
# WebSocket Server (Socket.io) — Porta 3001
# Utilizado para comunicação em tempo real entre o backend e o frontend Next.js.
# O frontend (browser) conecta via WebSocket para receber posições e alertas.
# ---------------------------------------------------------------------------
echo "[INFO] Liberando WebSocket Server (porta 3001)..."
ufw allow 3001/tcp

# ---------------------------------------------------------------------------
# HTTP — Porta 80
# Tráfego web padrão. Utilizado pelo Nginx/reverse proxy para:
#   - Servir o frontend Next.js
#   - Redirecionar para HTTPS (301)
#   - Verificações de health check do load balancer
# ---------------------------------------------------------------------------
echo "[INFO] Liberando HTTP (porta 80)..."
ufw allow 80/tcp

# ---------------------------------------------------------------------------
# HTTPS — Porta 443
# Tráfego web seguro. TLS obrigatório em produção.
# O Nginx/reverse proxy termina TLS e encaminha para a API (porta 3000)
# e WebSocket (porta 3001) internamente.
# ---------------------------------------------------------------------------
echo "[INFO] Liberando HTTPS (porta 443)..."
ufw allow 443/tcp

# ---------------------------------------------------------------------------
# Redis — Porta 6379 — BLOQUEADA EXPLICITAMENTE
# Redis é acessível APENAS via rede interna Docker (fleet_network).
# O docker-compose.yml não expõe a porta 6379 para o host.
# Esta regra nega qualquer tentativa de acesso externo, mesmo que
# o Docker mapeie acidentalmente a porta no futuro.
#
# Segurança: Redis 7 Alpine sem senha por padrão — se exposto, qualquer
# um pode ler/escrever chaves de idempotência e comprometer o sistema.
# ---------------------------------------------------------------------------
echo "[INFO] Bloqueando Redis (porta 6379) — apenas rede interna Docker..."
ufw deny 6379/tcp

# ---------------------------------------------------------------------------
# Habilitar UFW
# ---------------------------------------------------------------------------
echo ""
echo "[INFO] Habilitando UFW..."
# --force evita prompt interativo (necessário para scripts automatizados)
ufw --force enable

echo ""
echo "============================================================"
echo " Regras UFW aplicadas com sucesso!"
echo ""
ufw status verbose
echo ""
echo " LEMBRETE PRODUCAO:"
echo "   - Restrinja as portas 5432, 5672, 15672 por IP de origem"
echo "   - Redis (6379) deve permanecer BLOQUEADO"
echo "   - Para verificar: ufw status numbered"
echo "   - Para reverter: ufw disable && ufw reset"
echo "============================================================"
