import { railStationSeeds } from "./anchors.js";

export function normalizeStationQuery(query: string) {
  return query
    .toLowerCase()
    .replace(/[()/]/g, " ")
    .replace(/\b(?:mrt|lrt|station)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);

  for (let column = 1; column <= right.length; column += 1) {
    let previousDiagonal = rows[0];
    rows[0] = column;

    for (let row = 1; row <= left.length; row += 1) {
      const previous = rows[row];
      rows[row] = Math.min(
        rows[row] + 1,
        rows[row - 1] + 1,
        previousDiagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
      previousDiagonal = previous;
    }
  }

  return rows[left.length];
}

export function findExactStation(query: string) {
  const normalized = normalizeStationQuery(query);
  if (!normalized) {
    return null;
  }

  return (
    railStationSeeds.find((station) => normalizeStationQuery(station.name) === normalized) ??
    railStationSeeds.find((station) => {
      const stationName = normalizeStationQuery(station.name);
      return stationName.startsWith(`${normalized} `) || stationName.endsWith(` ${normalized}`);
    }) ??
    null
  );
}

export function getStationRecommendations(query: string) {
  const normalized = normalizeStationQuery(query);
  if (!normalized) {
    return railStationSeeds.slice(0, 8).map((station) => station.name);
  }

  const ranked = railStationSeeds
    .map((station) => {
      const stationName = normalizeStationQuery(station.name);
      const startsWith = stationName.startsWith(normalized);
      const includes = stationName.includes(normalized);

      if (!startsWith && !includes) {
        return null;
      }

      return {
        name: station.name,
        score: startsWith ? 0 : stationName.indexOf(normalized) + 1
      };
    })
    .filter((item): item is { name: string; score: number } => Boolean(item))
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name));

  if (ranked.length > 0) {
    return ranked.slice(0, 8).map((item) => item.name);
  }

  return railStationSeeds
    .map((station) => {
      const stationName = normalizeStationQuery(station.name);
      return {
        name: station.name,
        distance: editDistance(normalized, stationName)
      };
    })
    .filter((item) => item.distance <= 2)
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((item) => item.name);
}
