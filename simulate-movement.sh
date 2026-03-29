#!/usr/bin/env bash
# Simula movimentação de veículos cruzando a cerca do Pinheirinho.
#
# Cerca Pinheirinho: lat [-25.508, -25.470]  lng [-49.333, -49.300]
#
# Veículos que SAEM (dentro → fora):
#   ABC1D21  trajetória nordeste, cruza por lng > -49.300
#   ABC2D22  trajetória sul, cruza por lat < -25.508
#   ABC5D25  trajetória leste, cruza por lng > -49.300
#
# Veículo que ENTRA (fora → dentro):
#   ABC1D23  trajetória oeste, vem do nordeste e entra pelo topo da cerca

set -euo pipefail

API="http://localhost:3000/api/v1/gps"
INTERVAL=2   # segundos entre ondas

send() {
  local id="$1" placa="$2" lat="$3" lng="$4" vel="$5" ignicao="$6"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local body
  body=$(printf '{"veiculo_id":"%s","placa":"%s","lat":%s,"lng":%s,"velocidade":%s,"ignicao":%s,"timestamp":"%s"}' \
    "$id" "$placa" "$lat" "$lng" "$vel" "$ignicao" "$ts")
  local http_code
  http_code=$(curl -s -o /tmp/gps_resp.txt -w "%{http_code}" -X POST "$API" \
    -H "Content-Type: application/json" -d "$body")
  if [[ "$http_code" == "202" ]]; then
    printf "  ✓ %-8s  lat=%-9s lng=%-9s vel=%s km/h\n" "$placa" "$lat" "$lng" "$vel"
  else
    printf "  ✗ %-8s  HTTP %s — %s\n" "$placa" "$http_code" "$(cat /tmp/gps_resp.txt)"
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Simulação de movimentação — Frota Pinheirinho"
echo "  Saem: ABC1D21, ABC2D22, ABC5D25"
echo "  Entra: ABC1D23"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Onda 1 — posições iniciais (confirmação do estado atual) ─────────────────
echo ""
echo "▶ Onda 1/5 — posições atuais"
send "550e8400-e29b-41d4-a716-446655440001" "ABC1D21" -25.490  -49.315  35  true
send "550e8400-e29b-41d4-a716-446655440002" "ABC2D22" -25.496  -49.321  22  true
send "550e8400-e29b-41d4-a716-446655440005" "ABC5D25" -25.474  -49.303  60  true
send "550e8400-e29b-41d4-a716-446655440000" "ABC1D23" -25.428  -49.271   0  false
# Veículos que ficam — só atualiza posição
send "550e8400-e29b-41d4-a716-446655440003" "ABC3D23" -25.479  -49.308  48  true
send "550e8400-e29b-41d4-a716-446655440004" "ABC4D24" -25.503  -49.327  15  true
send "550e8400-e29b-41d4-a716-446655440099" "TST0A00" -25.484  -49.312  10  true
send "550e8400-e29b-41d4-a716-446655440010" "XYZ9A10" -25.515  -49.350  72  true
sleep "$INTERVAL"

# ── Onda 2 — veículos em movimento, aproximando-se da borda ─────────────────
echo ""
echo "▶ Onda 2/5 — movendo em direção à borda"
send "550e8400-e29b-41d4-a716-446655440001" "ABC1D21" -25.484  -49.302  42  true   # → leste
send "550e8400-e29b-41d4-a716-446655440002" "ABC2D22" -25.504  -49.320  28  true   # → sul
send "550e8400-e29b-41d4-a716-446655440005" "ABC5D25" -25.471  -49.301  65  true   # → nordeste
send "550e8400-e29b-41d4-a716-446655440000" "ABC1D23" -25.445  -49.282  25  true   # ← oeste, acelerando
sleep "$INTERVAL"

# ── Onda 3 — na borda da cerca ───────────────────────────────────────────────
echo ""
echo "▶ Onda 3/5 — veículos na borda da cerca"
send "550e8400-e29b-41d4-a716-446655440001" "ABC1D21" -25.476  -49.298  50  true   # quase saindo leste
send "550e8400-e29b-41d4-a716-446655440002" "ABC2D22" -25.507  -49.319  30  true   # quase saindo sul
send "550e8400-e29b-41d4-a716-446655440005" "ABC5D25" -25.469  -49.299  68  true   # quase saindo nordeste
send "550e8400-e29b-41d4-a716-446655440000" "ABC1D23" -25.463  -49.300  30  true   # na borda norte
sleep "$INTERVAL"

# ── Onda 4 — cruzamento da cerca ─────────────────────────────────────────────
echo ""
echo "▶ Onda 4/5 — cruzando a cerca  ⚠ alertas esperados"
send "550e8400-e29b-41d4-a716-446655440001" "ABC1D21" -25.471  -49.293  55  true   # SAIU — leste
send "550e8400-e29b-41d4-a716-446655440002" "ABC2D22" -25.512  -49.318  32  true   # SAIU — sul
send "550e8400-e29b-41d4-a716-446655440005" "ABC5D25" -25.467  -49.295  70  true   # SAIU — nordeste
send "550e8400-e29b-41d4-a716-446655440000" "ABC1D23" -25.476  -49.308  35  true   # ENTROU
sleep "$INTERVAL"

# ── Onda 5 — posições finais estabilizadas ───────────────────────────────────
echo ""
echo "▶ Onda 5/5 — posições finais"
send "550e8400-e29b-41d4-a716-446655440001" "ABC1D21" -25.468  -49.284  20  true   # fora, desacelerando
send "550e8400-e29b-41d4-a716-446655440002" "ABC2D22" -25.518  -49.317  10  true   # fora, parando
send "550e8400-e29b-41d4-a716-446655440005" "ABC5D25" -25.462  -49.287  15  true   # fora
send "550e8400-e29b-41d4-a716-446655440000" "ABC1D23" -25.482  -49.315  20  true   # dentro, navegando

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Simulação concluída."
echo "  Resultado esperado:"
echo "    Saíram da cerca : ABC1D21, ABC2D22, ABC5D25  → alertas geofence"
echo "    Entrou na cerca : ABC1D23"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
