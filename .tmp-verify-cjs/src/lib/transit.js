"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTransitMinutes = estimateTransitMinutes;
exports.estimateTransitMinutesBetween = estimateTransitMinutesBetween;
const geo_1 = require("./geo");
function timeOfDayPenalty(departureIso) {
    const hour = Number.parseInt(departureIso.slice(11, 13), 10);
    if (hour >= 23 || hour < 6) {
        return 12;
    }
    if ((hour >= 7 && hour < 9) || (hour >= 18 && hour < 20)) {
        return 6;
    }
    return 0;
}
function estimateTransitMinutes(query) {
    const distanceKm = (0, geo_1.haversineKm)(query.from, query.to);
    const baseSpeedKmh = query.modeHint === "rail" ? 30 : 22;
    const walkPenalty = query.modeHint === "rail" ? 8 : 5;
    const transferPenalty = query.modeHint === "rail" ? 5 : 2;
    const routePenalty = (0, geo_1.clamp)(distanceKm * 0.35, 1, 8);
    return Math.round((distanceKm / baseSpeedKmh) * 60 +
        walkPenalty +
        transferPenalty +
        routePenalty +
        timeOfDayPenalty(query.departureIso));
}
function estimateTransitMinutesBetween(from, to, departureIso, modeHint) {
    return estimateTransitMinutes({ from, to, departureIso, modeHint });
}
