/**
 * simulate-route.mjs
 *
 * Simula um veículo percorrendo a rota:
 *   Centro (Praça Tiradentes) → Pinheirinho → Sítio Cercado — Curitiba/PR
 *
 * Envia um evento GPS a cada 5 segundos para a api-ingestao.
 * O veículo entra e sai da cerca eletrônica do Pinheirinho durante o trajeto.
 *
 * Uso:
 *   node simulate-route.mjs
 *   node simulate-route.mjs --interval 2    (intervalo personalizado em segundos)
 *   node simulate-route.mjs --placa XYZ0001 (placa personalizada)
 */

// ─── Configuração ───────────────────────────────────────────────────────────

const API_URL   = process.env.API_URL   ?? 'http://localhost:3000/api/v1/gps';
const VEHICLE_ID = 'b1c2d3e4-0000-0000-0000-000000000099';

const args     = process.argv.slice(2);
const interval = Number(args[args.indexOf('--interval') + 1] || 5) * 1000;
const placa    = args[args.indexOf('--placa') + 1] || 'RTA0001';

// ─── Cerca do Pinheirinho (espelho do pinheirinho.ts) ───────────────────────
// lat ∈ [-25.508, -25.470]   lng ∈ [-49.333, -49.300]

function isInsidePinheirinho(lat, lng) {
  return lat >= -25.508 && lat <= -25.470
      && lng >= -49.333 && lng <= -49.300;
}

// ─── Waypoints da rota ──────────────────────────────────────────────────────
//
//  Fase 1 — Centro → borda norte da cerca          (FORA)
//  Fase 2 — Dentro do Pinheirinho                  (DENTRO)
//  Fase 3 — Borda sul da cerca → Sítio Cercado     (FORA)
//
//  Cada entrada: [lat, lng, velocidade_kmh, descricao]

const WAYPOINTS = [
  // ── Fase 1: Centro ──────────────────────────────────────────────────────
  [-25.4284, -49.2733,  0, 'Centro — Praça Tiradentes (partida)'],
  [-25.4370, -49.2810, 38, 'Bairro Alto da XV'],
  [-25.4470, -49.2920, 45, 'Bairro Rebouças'],
  [-25.4570, -49.3020, 50, 'Bairro Novo Mundo'],
  [-25.4630, -49.3080, 48, 'Bairro Capão Raso — aproximando'],
  [-25.4670, -49.3130, 42, 'Borda norte da cerca — entrando'],

  // ── Fase 2: Pinheirinho (dentro da cerca) ───────────────────────────────
  [-25.4720, -49.3160, 38, 'Pinheirinho — Av. Winston Churchill'],
  [-25.4790, -49.3200, 35, 'Pinheirinho — R. Guaíra'],
  [-25.4860, -49.3180, 38, 'Pinheirinho — R. João Bettega'],
  [-25.4930, -49.3120, 40, 'Pinheirinho — Av. Comendador Franco'],
  [-25.4990, -49.3070, 36, 'Pinheirinho — R. Guilherme Weiss'],
  [-25.5040, -49.3020, 30, 'Pinheirinho — borda sul, saindo'],

  // ── Fase 3: Sítio Cercado ───────────────────────────────────────────────
  [-25.5090, -49.2980, 38, 'Sítio Cercado — Av. Juscelino K. de Oliveira'],
  [-25.5170, -49.2910, 45, 'Sítio Cercado — R. Guilherme Ihlenfeldt'],
  [-25.5250, -49.2840, 48, 'Sítio Cercado — R. Francisco Schaaf'],
  [-25.5330, -49.2770, 40, 'Sítio Cercado — R. Joana Scalco'],
  [-25.5400, -49.2700, 25, 'Sítio Cercado — chegando ao destino'],
  [-25.5440, -49.2660,  0, 'Sítio Cercado — destino final (parado)'],
];

// ─── Helpers de terminal ────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${pad(m)}:${pad(s % 60)}`;
}

function badge(inside) {
  return inside
    ? `${GREEN}● DENTRO da cerca${RESET}`
    : `${RED}● FORA  da cerca${RESET}`;
}

// ─── Envio do evento GPS ────────────────────────────────────────────────────

async function sendEvent(waypoint, index, ts) {
  const [lat, lng, velocidade, descricao] = waypoint;
  const inside = isInsidePinheirinho(lat, lng);

  const body = JSON.stringify({
    veiculo_id: VEHICLE_ID,
    placa,
    lat,
    lng,
    velocidade,
    ignicao: true,
    timestamp: new Date().toISOString(),
  });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const status = res.status === 202 ? `${GREEN}202${RESET}` : `${RED}${res.status}${RESET}`;

    console.log(
      `${DIM}[${formatTime(ts)}]${RESET} ` +
      `${BOLD}${pad(index + 1, 2)}/${WAYPOINTS.length}${RESET} ` +
      `${badge(inside)}  ` +
      `${CYAN}${velocidade.toString().padStart(3)} km/h${RESET}  ` +
      `lat ${lat.toFixed(4)}  lng ${lng.toFixed(4)}  ` +
      `HTTP ${status}  ` +
      `${DIM}${descricao}${RESET}`
    );
  } catch (err) {
    console.error(`${RED}✗ Erro ao enviar waypoint ${index + 1}: ${err.message}${RESET}`);
  }
}

// ─── Loop principal ─────────────────────────────────────────────────────────

async function run() {
  const totalDuration = (WAYPOINTS.length - 1) * (interval / 1000);
  const minutes = Math.floor(totalDuration / 60);
  const seconds = totalDuration % 60;

  console.log('');
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}  Fleet Track — Simulação de Rota${RESET}`);
  console.log(`  Rota: Centro → Pinheirinho → Sítio Cercado`);
  console.log(`  Veículo: ${BOLD}${placa}${RESET}  |  Intervalo: ${interval / 1000}s por waypoint`);
  console.log(`  Total: ${WAYPOINTS.length} waypoints  |  Duração estimada: ${minutes}min ${seconds}s`);
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log('');
  console.log(`  ${YELLOW}Abra o mapa em http://localhost:3002 para acompanhar.${RESET}`);
  console.log('');

  const startTime = Date.now();

  for (let i = 0; i < WAYPOINTS.length; i++) {
    await sendEvent(WAYPOINTS[i], i, Date.now() - startTime);

    // Detecta cruzamento da cerca para destacar no terminal
    if (i > 0) {
      const prevInside = isInsidePinheirinho(WAYPOINTS[i - 1][0], WAYPOINTS[i - 1][1]);
      const currInside = isInsidePinheirinho(WAYPOINTS[i][0], WAYPOINTS[i][1]);

      if (!prevInside && currInside) {
        console.log(`\n  ${GREEN}${BOLD}▶ ENTROU na cerca do Pinheirinho${RESET}\n`);
      } else if (prevInside && !currInside) {
        console.log(`\n  ${RED}${BOLD}▶ SAIU da cerca do Pinheirinho  ⚠ alerta geofence gerado${RESET}\n`);
      }
    }

    if (i < WAYPOINTS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`  Rota concluída em ${elapsed}s.`);
  console.log(`  Verifique os alertas em: ${CYAN}http://localhost:3001/geofence-alerts${RESET}`);
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log('');
}

run().catch((err) => {
  console.error(`${RED}Erro fatal: ${err.message}${RESET}`);
  process.exit(1);
});
