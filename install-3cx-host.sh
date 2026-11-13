#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Spusťte skript jako root: sudo bash ./install-3cx-host.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ ! -f install-debian.sh || ! -f compose.yaml || ! -f .env.example ]]; then
  echo "Skript musí být spuštěn z kořene projektu 3CX Service Intake." >&2
  exit 1
fi

INSTALL_DOCKER=false
if [[ "${1:-}" == "--install-docker" && $# -eq 1 ]]; then
  INSTALL_DOCKER=true
elif [[ $# -gt 0 ]]; then
  echo "Použití: sudo bash ./install-3cx-host.sh [--install-docker]" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Nelze ověřit distribuci Linuxu." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != debian || ( "${VERSION_CODENAME:-}" != bookworm && "${VERSION_CODENAME:-}" != trixie ) ]]; then
  echo "Podporován je Debian 12 (Bookworm) nebo Debian 13 (Trixie)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [[ "$INSTALL_DOCKER" != "true" ]]; then
    echo "Docker Engine s Compose pluginem není dostupný." >&2
    echo "Výchozí režim nic neinstaluje do Debianu 3CX. Pokud přijímáte nepodporovaný stav PBX, spusťte znovu s --install-docker." >&2
    exit 1
  fi
  cat >&2 <<'EOF'
VAROVÁNÍ: tento krok instaluje systémové balíčky Dockeru na hostitele 3CX.
Podle pokynů 3CX tím změníte podporovanou konfiguraci systému.
Zálohujte/snapshotujte PBX a pokračujte pouze pro testovací nasazení.
EOF
  read -r -p "Pro potvrzení napište INSTALUJI-DOCKER-NA-3CX: " CONFIRM_DOCKER
  [[ "$CONFIRM_DOCKER" == "INSTALUJI-DOCKER-NA-3CX" ]] || exit 1
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      echo "Nalezen balíček $package, který může kolidovat s Docker CE. Skript jej automaticky neodstraní." >&2
      echo "Vyřešte tento konflikt ručně a spusťte instalaci znovu." >&2
      exit 1
    fi
  done
  apt-get update
  apt-get install -y ca-certificates curl git openssl python3
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon neběží nebo není dostupný." >&2
  exit 1
fi
if [[ -f .env ]] && ! grep -Fxq 'APP_BASE_PATH=/servis' .env; then
  echo "V tomto instalační režimu musí být APP_BASE_PATH=/servis. Upravte .env a před spuštěním aplikaci znovu sestavte." >&2
  exit 1
fi
for tool in curl openssl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Chybí příkaz $tool. Skript na hostiteli 3CX nebude instalovat systémové balíčky." >&2
    exit 1
  fi
done

if python3 - <<'PY'
import socket
s = socket.socket()
try:
    s.bind(('127.0.0.1', 3000))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
PY
then
  :
else
  echo "Port 127.0.0.1:3000 už používá jiná služba. Nic nebylo spuštěno." >&2
  exit 1
fi

AVAILABLE_KB="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
if (( AVAILABLE_KB < 1572864 )); then
  echo "VAROVÁNÍ: dostupná paměť je nižší než 1.5 GiB. Současný provoz 3CX a aplikace může být nestabilní." >&2
  read -r -p "Pokračovat i přesto? Napište POKRACOVAT: " CONFIRM
  [[ "$CONFIRM" == "POKRACOVAT" ]] || exit 1
fi

echo "Instaluji pouze kontejnery aplikace a databáze. Caddy ani porty 80/443 se nespouštějí; konfigurace Nginxu 3CX se neupravuje."
THREEX_HOST_MODE=true APP_BASE_PATH_DEFAULT=/servis bash ./install-debian.sh

cat <<'EOF'

Aplikace běží na http://127.0.0.1:3000 a očekává veřejnou cestu /servis/.
Nginx snippet je v deploy/3cx-service-intake.conf; jeho nasazení do 3CX je samostatný ruční krok.
Před přidáním snippetu ověřte jej stejným postupem, kterým jste ověřili konfiguraci Grafany.
EOF
