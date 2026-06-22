#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/bin"
DATA_DIR="${SCRIPT_DIR}/data"
LOCAL_JAVA_DIR="${HOME}/.local/java"
GRAPHHOPPER_VERSION="11.0"
GRAPHHOPPER_JAR="graphhopper-web-${GRAPHHOPPER_VERSION}.jar"
GRAPHHOPPER_JAR_URL="https://github.com/graphhopper/graphhopper/releases/download/${GRAPHHOPPER_VERSION}/${GRAPHHOPPER_JAR}"
GRAPHHOPPER_JAR_SHA256="b59c024afe172ec6ec85b6327006c3138ec58c7d0bcd26253d0e42853f613def"
JDK_TAG="jdk-17.0.19%2B10"
JDK_ARCHIVE="OpenJDK17U-jdk_x64_linux_hotspot_17.0.19_10.tar.gz"
JDK_URL="https://github.com/adoptium/temurin17-binaries/releases/download/${JDK_TAG}/${JDK_ARCHIVE}"
JDK_SHA256="d8afc263758141a66e0e3aafc321e783f7016696f4eaea067d340a269037d331"
JDK_EXTRACTED_DIR="${LOCAL_JAVA_DIR}/jdk-17.0.19+10"
PBF_URL="https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf"
PBF_PATH="${DATA_DIR}/singapore-enriched.osm.pbf"
FORCE_DOWNLOAD="${ROUTING_FORCE_DOWNLOAD:-0}"

log() {
  printf '[routing-bootstrap] %s\n' "$1"
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

download_to() {
  local url="$1"
  local target="$2"

  if have_cmd wget; then
    wget -O "${target}" "${url}"
  elif have_cmd curl; then
    curl -L --fail --retry 3 --retry-delay 2 -o "${target}" "${url}"
  else
    log "Need either wget or curl to download ${url}."
    exit 1
  fi
}

verify_sha256() {
  local file_path="$1"
  local expected="$2"
  local actual

  actual="$(sha256sum "${file_path}" | awk '{print $1}')"
  if [[ "${actual}" != "${expected}" ]]; then
    log "Checksum mismatch for ${file_path}"
    log "Expected: ${expected}"
    log "Actual:   ${actual}"
    exit 1
  fi
}

system_java_major() {
  if ! have_cmd java; then
    return 1
  fi

  java -version 2>&1 | awk -F '"' '/version/ { split($2, parts, "."); print parts[1]; exit }'
}

mkdir -p "${BIN_DIR}" "${DATA_DIR}" "${LOCAL_JAVA_DIR}"

if [[ "${FORCE_DOWNLOAD}" == "1" || ! -f "${BIN_DIR}/${GRAPHHOPPER_JAR}" ]]; then
  log "Downloading GraphHopper ${GRAPHHOPPER_VERSION}."
  download_to "${GRAPHHOPPER_JAR_URL}" "${BIN_DIR}/${GRAPHHOPPER_JAR}.part"
  mv "${BIN_DIR}/${GRAPHHOPPER_JAR}.part" "${BIN_DIR}/${GRAPHHOPPER_JAR}"
fi
verify_sha256 "${BIN_DIR}/${GRAPHHOPPER_JAR}" "${GRAPHHOPPER_JAR_SHA256}"

if [[ -d "${JDK_EXTRACTED_DIR}" ]]; then
  log "Using existing local JDK at ${JDK_EXTRACTED_DIR}."
else
  major_version="$(system_java_major || true)"
  if [[ "${major_version:-0}" -ge 17 ]]; then
    log "System Java ${major_version} is already sufficient."
  else
    log "Downloading local Temurin JDK 17 because system Java is missing or too old."
    download_to "${JDK_URL}" "${LOCAL_JAVA_DIR}/${JDK_ARCHIVE}.part"
    mv "${LOCAL_JAVA_DIR}/${JDK_ARCHIVE}.part" "${LOCAL_JAVA_DIR}/${JDK_ARCHIVE}"
    verify_sha256 "${LOCAL_JAVA_DIR}/${JDK_ARCHIVE}" "${JDK_SHA256}"
    tar -xzf "${LOCAL_JAVA_DIR}/${JDK_ARCHIVE}" -C "${LOCAL_JAVA_DIR}"
  fi
fi

if [[ "${FORCE_DOWNLOAD}" == "1" || ! -f "${PBF_PATH}" ]]; then
  log "Downloading raw Geofabrik extract to ${PBF_PATH}."
  download_to "${PBF_URL}" "${PBF_PATH}.part"
  mv "${PBF_PATH}.part" "${PBF_PATH}"
else
  log "Keeping existing ${PBF_PATH}."
fi

log "Bootstrap complete."
log "Next step: ${SCRIPT_DIR}/start-local.sh"
