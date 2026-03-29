# Fleet Track — Monitoramento de Frota em Tempo Real

Plataforma de rastreamento GPS com geofencing eletrônico focada no bairro **Pinheirinho, Curitiba - PR - Brasil**.
Eventos GPS chegam via HTTP, passam por uma fila RabbitMQ, são processados por um worker geoespacial e exibidos em mapa interativo via WebSocket — tudo em tempo real.

---

## Arquitetura

```
Dispositivo GPS
      │  POST /api/v1/gps
      ▼
┌─────────────────┐     Redis (dedup)     ┌─────────────────────┐
│  api-ingestao   │──────────────────────▶│  RabbitMQ           │
│  Fastify :3000  │   publica mensagem    │  q.pinheirinho      │
└─────────────────┘                       │  .gps.raw           │
                                          └──────────┬──────────┘
                                                     │ consume
                                                     ▼
                                          ┌─────────────────────┐
                                          │  tracking-worker    │
                                          │  Turf.js geofence   │
                                          │  PostGIS persist    │
                                          │  Socket.io :3001    │
                                          └──────────┬──────────┘
                                                     │ emit
                                                     ▼
                                          ┌─────────────────────┐
                                          │  Frontend Next.js   │
                                          │  React-Leaflet :3002│
                                          └─────────────────────┘
```

---

## Portas e Serviços

| Serviço             | URL                          | Descrição                                 |
|---------------------|------------------------------|-------------------------------------------|
| Frontend            | http://localhost:3002        | Mapa interativo (Next.js + React-Leaflet) |
| API de Ingestão     | http://localhost:3000        | POST /api/v1/gps                          |
| Tracking Worker     | http://localhost:3001        | WebSocket + /health + /status-atual       |
| RabbitMQ Management | http://localhost:15672       | Painel de filas (`fleet_admin` / `fleet_rabbit_change_me`) |
| Prometheus          | http://localhost:9090        | Interface de consulta de métricas         |
| Grafana             | http://localhost:3003        | Dashboards de observabilidade             |
| PostgreSQL          | localhost:5432               | Banco geoespacial (PostGIS)               |

---

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) com Docker Compose v2 (`docker compose`)
- [Node.js](https://nodejs.org/) v18 ou superior
- npm v9 ou superior

---

## Como Rodar o Projeto

> Cada serviço Node.js roda em um terminal separado.
> Execute os passos na ordem abaixo.

### 1. Clonar o repositório

```bash
git clone <url-do-repositorio>
cd frota
```

### 2. Infraestrutura (Docker)

```bash
# Copiar variáveis de ambiente da infraestrutura
# Os valores padrão já funcionam — não é necessário editar o arquivo
cp infrastructure/.env.example infrastructure/.env

# Subir todos os containers
docker compose -f infrastructure/docker-compose.yml up -d

# Aguardar os serviços ficarem saudáveis (~30s)
docker compose -f infrastructure/docker-compose.yml ps
```

Containers iniciados: `rabbitmq`, `postgres`, `redis`, `prometheus`, `grafana`, `postgres-exporter`.

### 3. Configurar Topologia do RabbitMQ

```bash
# Cria exchange, filas e bindings (idempotente — pode rodar múltiplas vezes)
bash infrastructure/scripts/setup-rabbitmq.sh
```

### 4. API de Ingestão GPS — Terminal 1

```bash
cd services/api-ingestao
cp .env.example .env   # valores padrão já funcionam
npm install
npm run dev
```

Aguardar: `"msg":"Server listening at http://0.0.0.0:3000"`

### 5. Tracking Worker — Terminal 2

```bash
cd services/tracking-worker
cp .env.example .env   # valores padrão já funcionam
npm install
npm run dev
```

Aguardar: `"msg":"tracking-worker ready — consuming q.pinheirinho.gps.raw"`

O worker executa as migrations SQL automaticamente na primeira inicialização.

### 6. Frontend — Terminal 3

```bash
cd services/frontend
cp .env.example .env.local   # valores padrão já funcionam
npm install
npm run dev -- --port 3002
```

Aguardar: `Ready on http://localhost:3002`

Abra **http://localhost:3002** no browser.

### 7. Verificar Saúde dos Serviços

```bash
# API de Ingestão
curl http://localhost:3000/health

# Tracking Worker
curl http://localhost:3001/health

# Posição atual dos veículos
curl http://localhost:3001/status-atual

# Alertas de geofence
curl http://localhost:3001/geofence-alerts
```

---

## Simular Rota Completa (Centro → Pinheirinho → Sítio Cercado)

Simula um veículo percorrendo uma rota real por Curitiba em 18 waypoints com intervalo de 5 segundos entre cada posição. O veículo entra e sai da cerca eletrônica do Pinheirinho durante o trajeto — visível em tempo real no mapa.

```bash
node simulate-route.mjs
```

**Opções disponíveis:**

```bash
# Intervalo personalizado (padrão: 5 segundos)
node simulate-route.mjs --interval 2

# Placa personalizada (padrão: RTA0001)
node simulate-route.mjs --placa XYZ9999

# Combinando opções
node simulate-route.mjs --interval 3 --placa TST0042
```

**Como acompanhar no frontend:**

1. Abra `http://localhost:3002` antes de iniciar o script
2. Execute `node simulate-route.mjs` no terminal
3. Observe o marcador se mover pelo mapa a cada envio
4. Quando o veículo entrar no Pinheirinho, o marcador fica **verde**
5. Quando sair da cerca, o marcador fica **vermelho** e o browser toca o **beep de alerta**
6. Veículos em movimento exibem **animação de pulso** no ícone (velocidade > 0)

**Rota e waypoints:**

```
Waypoint  Bairro / Local                      Cerca      Vel
────────  ──────────────────────────────────  ─────────  ────
 1        Centro — Praça Tiradentes           fora        0 km/h  (partida)
 2        Alto da XV                          fora       38 km/h
 3        Rebouças                            fora       45 km/h
 4        Novo Mundo                          fora       50 km/h
 5        Capão Raso                          fora       48 km/h
 6        Borda norte da cerca                fora       42 km/h
 7 ▶      Pinheirinho — Av. Winston Churchill DENTRO     38 km/h  ← entra
 8        Pinheirinho — R. Guaíra             DENTRO     35 km/h
 9        Pinheirinho — R. João Bettega       DENTRO     38 km/h
10        Pinheirinho — Av. Comendador Franco DENTRO     40 km/h
11        Pinheirinho — R. Guilherme Weiss    DENTRO     36 km/h
12        Pinheirinho — borda sul             DENTRO     30 km/h
13 ▶      Sítio Cercado — Av. JK de Oliveira  fora       38 km/h  ← sai + alerta
14        Sítio Cercado — R. G. Ihlenfeldt    fora       45 km/h
15        Sítio Cercado — R. Francisco Schaaf fora       48 km/h
16        Sítio Cercado — R. Joana Scalco     fora       40 km/h
17        Sítio Cercado — chegando            fora       25 km/h
18        Sítio Cercado — destino final       fora        0 km/h  (parado)
```

**Verificar alertas gerados após a simulação:**

```bash
curl http://localhost:3001/geofence-alerts
```

---

## Simular Movimentação de Múltiplos Veículos

O script envia eventos GPS em 5 ondas com intervalo de 2 segundos, simulando vários veículos cruzando a cerca simultaneamente:

```bash
bash simulate-movement.sh
```

**Comportamento esperado:**
- `ABC1D21`, `ABC2D22`, `ABC5D25` — saem da cerca (alertas `exit` gerados)
- `ABC1D23` — entra na cerca
- Marcadores no mapa mudam de cor (verde = dentro / vermelho = fora) em tempo real
- Veículos em movimento (velocidade > 0) exibem animação de pulso no ícone

**Enviar um evento avulso:**

```bash
curl -X POST http://localhost:3000/api/v1/gps \
  -H "Content-Type: application/json" \
  -d '{
    "veiculo_id": "550e8400-e29b-41d4-a716-446655440001",
    "placa": "ABC1D21",
    "lat": -25.490,
    "lng": -49.315,
    "velocidade": 45,
    "ignicao": true,
    "timestamp": "2026-03-28T18:00:00Z"
  }'
```

---

## Observabilidade

### Prometheus

Acesse **http://localhost:9090** para consultar métricas coletadas dos serviços.

Exemplos de queries úteis:

```promql
# Eventos GPS processados por status de geofence
gps_events_processed_total

# Taxa de ingestão (eventos/segundo nos últimos 5 min)
rate(gps_events_processed_total[5m])

# Alertas de geofence emitidos
geofence_alerts_total

# Latência de processamento (p95)
histogram_quantile(0.95, rate(gps_processing_duration_seconds_bucket[5m]))

# Requisições na API de ingestão
rate(http_requests_total{job="api-ingestao"}[5m])
```

Targets monitorados automaticamente:

| Job               | Endpoint                              |
|-------------------|---------------------------------------|
| `api-ingestao`    | http://localhost:3000/metrics         |
| `tracking-worker` | http://localhost:3001/metrics         |
| `rabbitmq`        | http://rabbitmq:15692/metrics         |
| `postgres`        | http://postgres-exporter:9187/metrics |
| `prometheus`      | http://localhost:9090/metrics         |

### Grafana

Acesse **http://localhost:3003**

| Campo  | Valor          |
|--------|----------------|
| Usuário | `admin`       |
| Senha   | `fleet_grafana` |

O dashboard **Fleet Track — Overview** é provisionado automaticamente e exibe:

- Requisições GPS por minuto
- Eventos processados por status (dentro/fora da cerca)
- Taxa de alertas de geofence
- Latência de processamento (p50, p95, p99)
- Filas RabbitMQ (mensagens prontas e não confirmadas)
- Métricas de infraestrutura (CPU, memória, conexões PostgreSQL)

> O datasource Prometheus é configurado automaticamente via provisionamento — nenhuma configuração manual é necessária.

---

## Solução de Problemas

### `EADDRINUSE` — porta já em uso

Ocorre quando o serviço já estava rodando de uma sessão anterior. Encerre o processo e reinicie:

```bash
# Liberar porta da API de Ingestão (3000)
lsof -ti:3000 | xargs kill -9

# Liberar porta do Tracking Worker (3001)
lsof -ti:3001 | xargs kill -9

# Liberar porta do Frontend (3002)
lsof -ti:3002 | xargs kill -9
```

### Worker falha ao iniciar — erro de conexão com o banco

O tracking-worker tenta executar migrations ao subir. Se o PostgreSQL ainda não estiver pronto:

```bash
# Verificar se o container está healthy
docker compose -f infrastructure/docker-compose.yml ps postgres

# Aguardar e tentar novamente
docker compose -f infrastructure/docker-compose.yml up -d postgres
```

### RabbitMQ `406 PRECONDITION_FAILED`

Ocorre se o setup de filas foi executado com parâmetros diferentes. Reexecute o script:

```bash
bash infrastructure/scripts/setup-rabbitmq.sh
```

### Frontend conecta mas não exibe veículos

1. Confirmar que o tracking-worker está rodando: `curl http://localhost:3001/health`
2. Verificar se há veículos no banco: `curl http://localhost:3001/status-atual`
3. Enviar um evento de teste para popular o banco:

```bash
curl -X POST http://localhost:3000/api/v1/gps \
  -H "Content-Type: application/json" \
  -d '{"veiculo_id":"550e8400-e29b-41d4-a716-446655440001","placa":"ABC1D21","lat":-25.490,"lng":-49.315,"velocidade":35,"ignicao":true,"timestamp":"2026-01-01T12:00:00Z"}'
```

### Grafana sem dados nos painéis

O datasource Prometheus é provisionado automaticamente. Se os painéis aparecerem vazios, recarregue via API:

```bash
curl -X POST http://admin:fleet_grafana@localhost:3003/api/admin/provisioning/datasources/reload
curl -X POST http://admin:fleet_grafana@localhost:3003/api/admin/provisioning/dashboards/reload
```

---

## Testes

```bash
# API de Ingestão (21 testes)
cd services/api-ingestao && npm test

# Tracking Worker (29 testes)
cd services/tracking-worker && npm test
```

---

## Estrutura do Projeto

```
frota/
├── infrastructure/
│   ├── docker-compose.yml          # Orquestração de containers
│   ├── .env                        # Variáveis de ambiente (não versionar)
│   ├── scripts/
│   │   └── setup-rabbitmq.sh       # Cria exchanges, filas e bindings
│   └── monitoring/
│       ├── prometheus.yml          # Configuração de scrape
│       └── grafana/
│           └── provisioning/       # Datasource e dashboard automáticos
│               ├── datasources/
│               └── dashboards/
├── services/
│   ├── api-ingestao/               # Fastify :3000 — recebe eventos GPS
│   ├── tracking-worker/            # Worker :3001 — geofence + Socket.io
│   └── frontend/                   # Next.js :3002 — mapa interativo
├── simulate-movement.sh            # Simulação de múltiplos veículos (bash)
├── simulate-route.mjs              # Simulação de rota real Centro→Pinheirinho→Sítio Cercado (Node.js)
└── README.md
```

---

## Regras de Negócio

- **Geofencing:** polígono do bairro Pinheirinho (bbox: lat −25.508/−25.470, lng −49.333/−49.300)
- **Alerta:** gerado toda vez que um veículo é detectado fora da cerca (`tipo: exit`)
- **Idempotência:** chave Redis `idempotency:{veiculo_id}:{timestamp}` previne processamento duplicado (TTL 5 min)
- **ACK manual:** o worker só confirma a mensagem no RabbitMQ após persistência bem-sucedida no PostgreSQL; em caso de falha, NACK com requeue
- **Ícones no mapa:** verde = dentro da cerca / vermelho = fora / pulsando = velocidade > 0 km/h
