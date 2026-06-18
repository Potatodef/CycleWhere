"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTransitQueries = buildTransitQueries;
exports.planRoutes = planRoutes;
const corridors_1 = require("../data/corridors");
const anchors_1 = require("../data/anchors");
const fairness_1 = require("./fairness");
const geo_1 = require("./geo");
const transit_1 = require("./transit");
function buildGeometry(start, corridor, detour) {
    const points = [
        start,
        ...detour.controlPoints.map((control) => (0, geo_1.offsetPerpendicularKm)(start, corridor.endpoint, control.t, control.perpendicularKm)),
        corridor.endpoint
    ];
    return points;
}
function routeSignature(points) {
    const signature = [];
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        signature.push(`${previous.lat.toFixed(3)},${previous.lng.toFixed(3)}->${current.lat.toFixed(3)},${current.lng.toFixed(3)}`);
    }
    return signature;
}
function overlapRatio(a, b) {
    const aSet = new Set(a);
    const bSet = new Set(b);
    const intersection = [...aSet].filter((value) => bSet.has(value)).length;
    const union = new Set([...aSet, ...bSet]).size || 1;
    return intersection / union;
}
function getPreferredAnchorPoint(corridor) {
    return (anchors_1.anchorSeeds.find((anchor) => anchor.id === corridor.preferredAnchorId)?.point ??
        corridor.endpoint);
}
function routeTransitKey(routeId, participantId) {
    return `${routeId}::${participantId}`;
}
function scoreRoute(route) {
    return (route.fairnessSpreadMinutes * 100 +
        route.fairnessStdDeviationMinutes * 10 -
        route.commonCorridorCoverage * 5 +
        route.averageJourneyHomeMinutes * 0.2);
}
function distanceBand(value) {
    if (value < 10) {
        return "short";
    }
    if (value < 20) {
        return "mid";
    }
    if (value < 35) {
        return "long";
    }
    return "epic";
}
function buildTransitQueries({ start, participants, startTimeIso }) {
    const queries = [];
    for (const corridor of corridors_1.corridorSeeds) {
        for (const detour of corridor.detours) {
            const routeId = `${corridor.id}-${detour.id}`;
            const geometry = buildGeometry(start.point, corridor, detour);
            const rawDistance = (0, geo_1.polylineDistanceKm)(geometry) * detour.distanceMultiplier;
            const distanceKm = Math.round(rawDistance * 10) / 10;
            const cyclingMinutes = Math.round((distanceKm / 16) * 60);
            const transitDeparture = new Date(startTimeIso);
            transitDeparture.setMinutes(transitDeparture.getMinutes() + cyclingMinutes + 90);
            const departureIso = transitDeparture.toISOString();
            const preferredAnchor = getPreferredAnchorPoint(corridor);
            const endpointForTransit = (0, geo_1.haversineKm)(preferredAnchor, corridor.endpoint) < 1
                ? corridor.endpoint
                : preferredAnchor;
            for (const participant of participants) {
                queries.push({
                    key: routeTransitKey(routeId, participant.id),
                    query: {
                        from: endpointForTransit,
                        to: participant.anchor.point,
                        departureIso,
                        modeHint: participant.anchor.kind
                    }
                });
            }
        }
    }
    return queries;
}
function planCandidateRoutes({ start, participants, startTimeIso, transitOverrides }) {
    const startPoint = start.point;
    return corridors_1.corridorSeeds
        .flatMap((corridor) => corridor.detours.map((detour) => {
        const geometry = buildGeometry(startPoint, corridor, detour);
        const rawDistance = (0, geo_1.polylineDistanceKm)(geometry) * detour.distanceMultiplier;
        const distanceKm = Math.round(rawDistance * 10) / 10;
        const cyclingMinutes = Math.round((distanceKm / 16) * 60);
        const transitDeparture = new Date(startTimeIso);
        transitDeparture.setMinutes(transitDeparture.getMinutes() + cyclingMinutes + 90);
        const departureIso = transitDeparture.toISOString();
        const preferredAnchor = getPreferredAnchorPoint(corridor);
        const participantTimes = participants.map((participant) => {
            const routeId = `${corridor.id}-${detour.id}`;
            const endpointForTransit = (0, geo_1.haversineKm)(preferredAnchor, corridor.endpoint) < 1
                ? corridor.endpoint
                : preferredAnchor;
            const transitMinutes = transitOverrides?.[routeTransitKey(routeId, participant.id)] ??
                (0, transit_1.estimateTransitMinutesBetween)(endpointForTransit, participant.anchor.point, departureIso, participant.anchor.kind);
            return {
                participantId: participant.id,
                participantName: participant.name,
                anchorName: participant.anchor.name,
                transitMinutes
            };
        });
        const times = participantTimes.map((participant) => participant.transitMinutes);
        const fairnessSpreadMinutes = (0, fairness_1.spread)(times);
        const fairnessStdDeviationMinutes = Math.round((0, fairness_1.standardDeviation)(times) * 10) / 10;
        const averageJourneyHomeMinutes = Math.round((0, fairness_1.average)(times));
        const pcnCoverage = (0, geo_1.clamp)(corridor.basePcnCoverage - detour.distanceMultiplier * 0.02, 0.45, 0.95);
        const cyclingPathCoverage = (0, geo_1.clamp)(corridor.baseCyclingPathCoverage + (detour.distanceMultiplier - 1) * 0.08, 0.04, 0.34);
        const commonCorridorCoverage = (0, geo_1.clamp)(corridor.baseCommonCorridorCoverage + (detour.distanceMultiplier - 1) * 0.12, 0.3, 0.92);
        const mixedTrafficMeters = Math.round(corridor.baseMixedTrafficMeters + Math.max(0, distanceKm - 15) * 4);
        const route = {
            id: `${corridor.id}-${detour.id}`,
            corridorId: corridor.id,
            corridorName: corridor.name,
            routeName: detour.name,
            endpointName: corridor.endpointName,
            endpoint: corridor.endpoint,
            geometry,
            distanceKm,
            cyclingMinutes,
            pcnCoverage,
            cyclingPathCoverage,
            commonCorridorCoverage,
            mixedTrafficMeters,
            averageJourneyHomeMinutes,
            fairnessSpreadMinutes,
            fairnessStdDeviationMinutes,
            fairnessTier: (0, fairness_1.classifyFairness)(fairnessSpreadMinutes),
            participantTimes,
            popularityEvidence: corridor.evidence,
            majorityFriendly: fairnessSpreadMinutes > 30 && (0, fairness_1.majorityFriendlySpread)(times),
            overlapSignature: routeSignature(geometry)
        };
        return route;
    }))
        .filter((route) => route.mixedTrafficMeters <= 250)
        .filter((route) => route.distanceKm >= 3);
}
function selectDiverseRoutes(candidates) {
    const chosen = [];
    const byScore = [...candidates].sort((a, b) => scoreRoute(a) - scoreRoute(b));
    const bandCounts = new Map();
    for (const candidate of byScore) {
        const band = distanceBand(candidate.distanceKm);
        const usedInBand = bandCounts.get(band) ?? 0;
        if (usedInBand >= 2) {
            continue;
        }
        const tooSimilar = chosen.some((existing) => {
            const overlap = overlapRatio(existing.overlapSignature, candidate.overlapSignature);
            const distanceDelta = Math.abs(existing.distanceKm - candidate.distanceKm) / existing.distanceKm;
            return overlap >= 0.75 && distanceDelta < 0.2;
        });
        if (tooSimilar) {
            continue;
        }
        chosen.push(candidate);
        bandCounts.set(band, usedInBand + 1);
        if (chosen.length >= 8) {
            break;
        }
    }
    return chosen.sort((a, b) => a.distanceKm - b.distanceKm);
}
function planRoutes(input) {
    const candidates = planCandidateRoutes(input);
    const primaryPool = candidates.filter((route) => route.fairnessSpreadMinutes <= 30);
    const unevenPool = candidates.filter((route) => route.fairnessSpreadMinutes > 30);
    const primary = selectDiverseRoutes(primaryPool);
    const uneven = input.participants.length >= 4
        ? selectDiverseRoutes(unevenPool.filter((route) => route.majorityFriendly)).slice(0, 2)
        : [];
    return {
        primary,
        uneven,
        computedAt: new Date().toISOString()
    };
}
