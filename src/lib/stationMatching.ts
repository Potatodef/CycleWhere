export function normalizeStationQuery(query: string) {
  return query
    .toLowerCase()
    .replace(/[()/]/g, " ")
    .replace(/\b(?:mrt|lrt|station)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stationNameMatchesQuery(stationName: string, query: string) {
  const normalizedStationName = normalizeStationQuery(stationName);
  const normalizedQuery = normalizeStationQuery(query);
  if (!normalizedStationName || !normalizedQuery) {
    return false;
  }
  return (
    normalizedStationName === normalizedQuery ||
    normalizedStationName.startsWith(`${normalizedQuery} `) ||
    normalizedStationName.endsWith(` ${normalizedQuery}`)
  );
}

export function hasExplicitStationSuffix(query: string) {
  return /\b(?:mrt|lrt|station)\b/i.test(query);
}
