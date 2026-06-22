#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_TEMPLATE="${SCRIPT_DIR}/config/config.yml"
TMP_CONFIG="${SCRIPT_DIR}/.tmp-local-config.yml"
GRAPH_CACHE_DIR="${SCRIPT_DIR}/graph-cache"
JAR_PATH="${SCRIPT_DIR}/bin/graphhopper-web-11.0.jar"
PBF_PATH="${SCRIPT_DIR}/data/singapore-enriched.osm.pbf"
LOCAL_JAVA_BIN="${HOME}/.local/java/jdk-17.0.19+10/bin/java"

log() {
  printf '[routing-start] %s\n' "$1"
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

java_major() {
  local java_bin="$1"
  "${java_bin}" -version 2>&1 | awk -F '"' '/version/ { split($2, parts, "."); print parts[1]; exit }'
}

pick_java() {
  if [[ -n "${GRAPHHOPPER_JAVA_BIN:-}" && -x "${GRAPHHOPPER_JAVA_BIN}" ]]; then
    printf '%s\n' "${GRAPHHOPPER_JAVA_BIN}"
    return
  fi

  if [[ -x "${LOCAL_JAVA_BIN}" ]]; then
    printf '%s\n' "${LOCAL_JAVA_BIN}"
    return
  fi

  if have_cmd java; then
    local major
    major="$(java_major java)"
    if [[ "${major}" -ge 17 ]]; then
      printf '%s\n' "java"
      return
    fi
  fi

  log "Need Java 17+. Run ${SCRIPT_DIR}/bootstrap-local.sh first or set GRAPHHOPPER_JAVA_BIN."
  exit 1
}

if [[ ! -f "${JAR_PATH}" ]]; then
  log "Missing ${JAR_PATH}. Run ${SCRIPT_DIR}/bootstrap-local.sh first."
  exit 1
fi

if [[ ! -f "${PBF_PATH}" ]]; then
  log "Missing ${PBF_PATH}. Run ${SCRIPT_DIR}/bootstrap-local.sh first."
  exit 1
fi

mkdir -p "${GRAPH_CACHE_DIR}"

sed \
  -e "s#/data/singapore-enriched.osm.pbf#${PBF_PATH}#" \
  -e "s#/graph-cache#${GRAPH_CACHE_DIR}#" \
  -e "s#/config/custom-models#${SCRIPT_DIR}/config/custom-models#" \
  "${CONFIG_TEMPLATE}" > "${TMP_CONFIG}"

JAVA_BIN="$(pick_java)"
log "Starting GraphHopper with ${JAVA_BIN}."
log "Routing API will listen on http://127.0.0.1:8989 once import finishes."
exec "${JAVA_BIN}" -jar "${JAR_PATH}" server "${TMP_CONFIG}"
