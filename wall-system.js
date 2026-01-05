/**
 * Wall Boundary System for PlayCanvas
 * Ported from Three.js splatter version
 * Uses 2D line-segment intersection for fast collision detection
 */

// Wall segments define invisible boundaries
// Loaded from studioplex_walls.json (created with wall editor F key)
export const WALL_SEGMENTS = [
    {
        "name": "wall_0",
        "start": {
            "x": -0.5768624544143677,
            "z": 154.2949676513672
        },
        "end": {
            "x": -2.19569993019104,
            "z": 165.52789306640625
        },
        "color": 65280
    },
    {
        "name": "wall_1",
        "start": {
            "x": -1.189516305923462,
            "z": 165.15744018554688
        },
        "end": {
            "x": -12.322547912597656,
            "z": 163.4005889892578
        },
        "color": 65280
    },
    {
        "name": "wall_2",
        "start": {
            "x": -12.319146156311035,
            "z": 163.25062561035156
        },
        "end": {
            "x": -11.748414993286133,
            "z": 154.12403869628906
        },
        "color": 65280
    }
];

/**
 * Check if movement crosses any wall segment
 * @param {Object} oldPos - Previous position {x, y, z}
 * @param {Object} newPos - New position {x, y, z}
 * @returns {boolean} - true if collision detected
 */
export function checkWallCollision(oldPos, newPos) {
    for (const segment of WALL_SEGMENTS) {
        if (lineSegmentsIntersect(
            oldPos.x, oldPos.z,
            newPos.x, newPos.z,
            segment.start.x, segment.start.z,
            segment.end.x, segment.end.z
        )) {
            return true; // Collision detected
        }
    }
    return false; // No collision
}

/**
 * Check if two line segments intersect (2D)
 * Pure math - works in any framework
 * @returns {boolean} - true if segments intersect
 */
function lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    if (Math.abs(denom) < 0.0001) {
        return false; // Lines are parallel
    }

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Get info about which wall was hit (for debugging)
 * @param {Object} oldPos - Previous position {x, y, z}
 * @param {Object} newPos - New position {x, y, z}
 * @returns {Object|null} - Wall segment info or null
 */
export function getWallCollisionInfo(oldPos, newPos) {
    for (const segment of WALL_SEGMENTS) {
        if (lineSegmentsIntersect(
            oldPos.x, oldPos.z,
            newPos.x, newPos.z,
            segment.start.x, segment.start.z,
            segment.end.x, segment.end.z
        )) {
            return {
                wall: segment.name,
                start: segment.start,
                end: segment.end
            };
        }
    }
    return null;
}

/**
 * Add a new wall segment
 */
export function addWallSegment(start, end, name, color = 0x00ff00) {
    WALL_SEGMENTS.push({
        name: name || `wall_${WALL_SEGMENTS.length}`,
        start: { x: start.x, z: start.z },
        end: { x: end.x, z: end.z },
        color: color
    });
}

/**
 * Remove a wall segment by name
 */
export function removeWallSegment(name) {
    const index = WALL_SEGMENTS.findIndex(s => s.name === name);
    if (index > -1) {
        WALL_SEGMENTS.splice(index, 1);
        return true;
    }
    return false;
}

/**
 * Get wall segment by name
 */
export function getWallSegment(name) {
    return WALL_SEGMENTS.find(s => s.name === name);
}

/**
 * Clear all wall segments
 */
export function clearAllWalls() {
    WALL_SEGMENTS.length = 0;
}
