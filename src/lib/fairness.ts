import type { FairnessTier } from "../types";

export function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function spread(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Math.max(...values) - Math.min(...values);
}

export function classifyFairness(spreadMinutes: number): FairnessTier {
  if (spreadMinutes < 10) {
    return "Excellent";
  }
  if (spreadMinutes < 20) {
    return "Fair";
  }
  if (spreadMinutes <= 30) {
    return "Stretched";
  }
  return "Uneven";
}

export function majorityFriendlySpread(values: number[]) {
  if (values.length < 4) {
    return false;
  }

  for (let index = 0; index < values.length; index += 1) {
    const subset = values.filter((_, candidateIndex) => candidateIndex !== index);
    if (spread(subset) <= 20) {
      return true;
    }
  }

  return false;
}
