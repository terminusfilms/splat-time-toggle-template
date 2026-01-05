/**
 * Splat Time Toggle - Configuration
 *
 * Configure your two temporal splat captures and alignment transform here.
 * Use SplatAlign (https://github.com/terminusfilms/splatalign) to generate
 * the alignment transform matrix.
 */

// Parse URL parameters for debugging
const urlParams = new URLSearchParams(window.location.search);
const getParam = (key, defaultVal) => {
    const val = urlParams.get(key);
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val !== null && !isNaN(Number(val))) return Number(val);
    return val !== null ? val : defaultVal;
};

export const config = {
    // Scene identifier
    sceneName: 'my-time-toggle-scene',

    // Optional: Collision mesh (GLB file, decimated from your scene)
    // Set to null to disable collision
    collisionMesh: null,  // e.g., './collision_mesh.glb'

    // Debug Flags
    debug: getParam('debug', false),
    showColliders: getParam('colliders', false),

    // Movement Settings
    moveSpeed: getParam('speed', 0.0625),
    maxMoveSpeed: getParam('maxSpeed', 0.125),
    turnSpeed: 0.002,

    // Camera Settings
    fov: 50,
    startPosition: { x: 0, y: 1.6, z: 5 },  // Adjust to your scene
    startRotation: { x: 0, y: 180, z: 0 },   // Facing -Z
    maxY: 10.0,  // Maximum camera height

    // LOD Settings (adjust based on your splat size)
    lod: {
        desktop: {
            range: [3, 5],
            lodDistances: [5, 12, 25, 50, 80, 110, 140]
        },
        mobile: {
            range: [3, 5],
            lodDistances: [5, 12, 25, 50, 80, 110, 140]
        }
    },

    // ===========================================
    // TIME TOGGLE CONFIGURATION
    // ===========================================
    timeToggle: {
        enabled: true,

        // Which time state to show on load
        defaultTime: 'primary',

        // Your two temporal captures
        // - path: folder containing lod-meta.json from splat-transform
        // - label: display name in UI
        times: [
            {
                id: 'primary',
                label: 'Before',  // e.g., 'October 2025', 'Summer', 'Pre-renovation'
                path: './splats/primary/'
            },
            {
                id: 'secondary',
                label: 'After',   // e.g., 'December 2025', 'Winter', 'Post-renovation'
                path: './splats/secondary/'
            }
        ],

        // Alignment transforms from SplatAlign
        // - Primary scene: null (reference, no transform)
        // - Secondary scene: paste matrix_column_major_flat from SplatAlign output
        transforms: {
            primary: null,
            secondary: [
                // PASTE YOUR SPLATALIGN OUTPUT HERE
                // Example (identity matrix - replace with your actual transform):
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            ]
        },

        // LOD level for preloading inactive time (higher = lower quality, faster load)
        preloadInactiveLOD: 5
    },

    // Scene-level LOD behavior (advanced - usually don't need to change)
    sceneLOD: {
        lodUpdateAngle: 90,
        lodBehindPenalty: 5,
        radialSorting: true,
        lodUpdateDistance: 0.5,
        lodUnderfillLimit: 5,
        colorUpdateDistance: 1,
        colorUpdateAngle: 4,
        colorUpdateDistanceLodScale: 2,
        colorUpdateAngleLodScale: 2
    },

    // Mobile touch sensitivity
    mobileSensitivity: 0.93,

    // Wall boundaries (optional, for constraining movement)
    wallHeight: 50,
    wallColor: 0x00ff00
};

// Helper to detect mobile device
export function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
}
