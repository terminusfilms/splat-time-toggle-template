/**
 * Time Toggle System for Multi-Temporal 3DGS Scenes
 *
 * Manages loading and switching between gaussian splat scenes captured at different times.
 * Uses LOD-aware loading to minimize memory while enabling seamless time transitions.
 */

import * as pc from 'playcanvas';

export class TimeToggleSystem {
    constructor(app, config) {
        this.app = app;
        this.config = config.timeToggle;
        this.fullConfig = config; // Keep reference to full config for LOD settings

        // Time state management
        this.times = this.config.times;
        this.activeTimeId = this.config.defaultTime;
        this.splatEntities = {}; // { timeId: pc.Entity }
        this.splatAssets = {};   // { timeId: pc.Asset }
        this.loadingStates = {}; // { timeId: 'loading' | 'loaded' | 'error' }

        // Comparison endpoints (which two times the slider compares)
        this.leftEndpoint = this.times[0].id;  // oldest by default
        this.rightEndpoint = this.times[this.times.length - 1].id;  // newest by default

        // Transition state
        this.transitioning = false;
        this.transitionProgress = 0;
        this.transitionFrom = null;
        this.transitionTo = null;
        this.transitionDuration = 0.5; // seconds

        // Debounce/lock to prevent rapid switching
        this.switchLock = false;
        this.switchCooldown = 300; // ms minimum between switches


        // UI elements
        this.sliderContainer = null;
        this.toggleBtn = null;

        // Callbacks
        this.onTimeChange = null;

        console.log('TimeToggleSystem initialized with', this.times.length, 'time states');
    }

    /**
     * Initialize the system - load primary time state and create UI
     */
    async initialize() {
        // Create UI first
        this.createUI();

        // Load the default/active time state fully
        await this.loadTimeState(this.activeTimeId, false);

        // Single scene loading - no preload on any platform
        // Dual scene loading causes memory pressure and coverage gaps
        console.log('Single scene mode: skipping preload, will load on-demand when toggling');

        return this.splatEntities[this.activeTimeId];
    }

    /**
     * Load a time state's splat data
     * @param {string} timeId - The time state to load
     * @param {boolean} preload - If true, loads at lowest LOD for preview
     */
    async loadTimeState(timeId, preload = false) {
        const timeConfig = this.times.find(t => t.id === timeId);
        if (!timeConfig) {
            console.error('Unknown time state:', timeId);
            return null;
        }

        if (this.loadingStates[timeId] === 'loaded') {
            console.log(`Time state ${timeId} already loaded`);
            return this.splatEntities[timeId];
        }

        if (this.loadingStates[timeId] === 'loading') {
            console.log(`Time state ${timeId} already loading, waiting...`);
            // Wait for existing load to complete
            return new Promise((resolve) => {
                const checkLoaded = setInterval(() => {
                    if (this.loadingStates[timeId] === 'loaded') {
                        clearInterval(checkLoaded);
                        resolve(this.splatEntities[timeId]);
                    }
                }, 100);
            });
        }

        this.loadingStates[timeId] = 'loading';
        console.log(`Loading time state: ${timeId} (preload: ${preload})`);

        return new Promise((resolve, reject) => {
            const asset = new pc.Asset(`splat_${timeId}`, 'gsplat', {
                url: `${timeConfig.path}lod-meta.json`
            });

            this.app.assets.add(asset);
            this.splatAssets[timeId] = asset;

            asset.ready(() => {
                const entity = new pc.Entity(`splat_${timeId}`);
                entity.addComponent('gsplat', {
                    asset: asset,
                    layers: [0],
                    unified: true
                });

                // Apply alignment transform if specified (from ICP alignment)
                const transformData = this.config.transforms[timeId];
                if (transformData && Array.isArray(transformData) && transformData.length === 16) {
                    // The ICP transform aligns Dec to Oct in Z-up space
                    // We need: Y-up rotation * ICP alignment
                    // So: first align in Z-up, then rotate to Y-up

                    // Create the -90 X rotation matrix (Z-up to Y-up)
                    const zToYMat = new pc.Mat4();
                    zToYMat.setFromEulerAngles(-90, 0, 0);

                    // Create alignment matrix from column-major data
                    const alignmentMat = new pc.Mat4();
                    alignmentMat.set(transformData);

                    // Combined: rotation * alignment (apply alignment first, then rotate)
                    const combinedMat = new pc.Mat4();
                    combinedMat.copy(zToYMat);
                    combinedMat.mul(alignmentMat);

                    // Extract position and rotation from combined matrix
                    const pos = new pc.Vec3();
                    const scale = new pc.Vec3();
                    combinedMat.getTranslation(pos);
                    combinedMat.getScale(scale);

                    // For rotation, use the matrix directly via euler angles
                    // Extract rotation by removing scale
                    const rotMat = new pc.Mat4();
                    rotMat.copy(combinedMat);
                    // Normalize the rotation part
                    const sx = 1 / scale.x, sy = 1 / scale.y, sz = 1 / scale.z;
                    rotMat.data[0] *= sx; rotMat.data[1] *= sx; rotMat.data[2] *= sx;
                    rotMat.data[4] *= sy; rotMat.data[5] *= sy; rotMat.data[6] *= sy;
                    rotMat.data[8] *= sz; rotMat.data[9] *= sz; rotMat.data[10] *= sz;

                    const rot = new pc.Quat();
                    rot.setFromMat4(rotMat);

                    entity.setLocalPosition(pos);
                    entity.setLocalRotation(rot);
                    entity.setLocalScale(scale);

                    console.log(`Applied alignment transform for ${timeId}`, { pos, scale });
                } else {
                    // No alignment transform - just apply Z-up to Y-up rotation
                    entity.setEulerAngles(-90, 0, 0);
                }

                // If not the active time, hide it
                if (timeId !== this.activeTimeId) {
                    entity.enabled = false;
                }

                this.app.root.addChild(entity);
                this.splatEntities[timeId] = entity;
                this.loadingStates[timeId] = 'loaded';

                // Apply LOD distances from config (critical for proper chunk loading)
                const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                    (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
                const lodPreset = this.fullConfig.lod[isMobileDevice ? 'mobile' : 'desktop'];
                if (entity.gsplat && lodPreset?.lodDistances) {
                    entity.gsplat.lodDistances = lodPreset.lodDistances;
                    console.log(`Applied lodDistances to ${timeId}:`, lodPreset.lodDistances);
                }

                console.log(`Time state loaded: ${timeId}`);
                resolve(entity);
            });

            asset.on('error', (err) => {
                console.error(`Error loading time state ${timeId}:`, err);
                this.loadingStates[timeId] = 'error';
                reject(err);
            });

            this.app.assets.load(asset);
        });
    }

    /**
     * Create simple toggle button UI
     */
    createUI() {
        // Container
        this.sliderContainer = document.createElement('div');
        this.sliderContainer.id = 'time-toggle-container';
        this.sliderContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            user-select: none;
            -webkit-user-select: none;
        `;

        // Add responsive positioning for mobile
        const mobileStyles = document.createElement('style');
        mobileStyles.textContent = `
            #time-toggle-container,
            #time-toggle-container * {
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            /* Portrait mobile: move to top */
            @media (max-width: 768px) and (orientation: portrait) {
                #time-toggle-container {
                    bottom: auto !important;
                    top: 10px !important;
                }
            }
            /* Landscape mobile */
            @media (max-height: 500px) and (orientation: landscape) {
                #time-toggle-container {
                    bottom: 10px !important;
                }
            }
            /* Only show hover on devices with hover capability */
            @media (hover: hover) {
                #time-toggle-btn:hover {
                    background: rgba(74, 144, 217, 0.8) !important;
                    transform: scale(1.05);
                }
            }
            #time-toggle-btn:active {
                background: rgba(74, 144, 217, 0.6) !important;
                transform: scale(0.95);
                transition: none;
            }
        `;
        document.head.appendChild(mobileStyles);

        // Toggle button
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.id = 'time-toggle-btn';
        this.updateButtonLabel();
        this.toggleBtn.style.cssText = `
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(10px);
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 25px;
            padding: 12px 24px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        this.toggleBtn.addEventListener('click', () => this.toggle());

        this.sliderContainer.appendChild(this.toggleBtn);
        document.body.appendChild(this.sliderContainer);

        console.log('Time toggle button UI created');
    }

    /**
     * Update button label to show current time
     */
    updateButtonLabel() {
        if (!this.toggleBtn) return;
        const activeTime = this.times.find(t => t.id === this.activeTimeId);
        const otherTime = this.times.find(t => t.id !== this.activeTimeId);
        this.toggleBtn.innerHTML = `🕐 ${activeTime?.label || this.activeTimeId} <span style="opacity:0.6">→ ${otherTime?.label || ''}</span>`;
    }

    /**
     * Toggle between the two time states
     */
    toggle() {
        const otherTimeId = this.times.find(t => t.id !== this.activeTimeId)?.id;
        if (otherTimeId) {
            this.switchToTime(otherTimeId);
        }
    }

    /**
     * Switch to a different time state
     * @param {string} timeId - The time state to switch to
     */
    async switchToTime(timeId) {
        if (timeId === this.activeTimeId) {
            return;
        }

        // Prevent rapid switching that causes PlayCanvas assertion errors
        if (this.switchLock) {
            console.log('Switch locked, ignoring rapid switch request');
            return;
        }

        this.switchLock = true;

        console.log(`Switching from ${this.activeTimeId} to ${timeId}`);

        // Ensure target is loaded
        if (this.loadingStates[timeId] !== 'loaded') {
            if (this.toggleBtn) this.toggleBtn.textContent = '🕐 Loading...';
            await this.loadTimeState(timeId, false);
        }

        const fromEntity = this.splatEntities[this.activeTimeId];
        const toEntity = this.splatEntities[timeId];

        if (!fromEntity || !toEntity) {
            console.error('Missing entities for transition');
            this.switchLock = false;
            return;
        }

        // Enable new entity first, then disable old one to avoid black frame
        toEntity.enabled = true;

        // Wait two frames for the new entity to fully render, then disable old
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    fromEntity.enabled = false;
                    resolve();
                });
            });
        });

        const previousTime = this.activeTimeId;
        this.activeTimeId = timeId;
        this.updateButtonLabel();

        console.log(`Switched to time state: ${timeId}`);

        // Fire callback if registered
        if (this.onTimeChange) {
            this.onTimeChange(timeId, previousTime);
        }

        // Release lock after cooldown
        setTimeout(() => {
            this.switchLock = false;
        }, this.switchCooldown);
    }

    /**
     * Get the currently active splat entity
     */
    getActiveSplatEntity() {
        return this.splatEntities[this.activeTimeId];
    }

    /**
     * Get the current time ID
     */
    getActiveTimeId() {
        return this.activeTimeId;
    }

    /**
     * Hide/show the UI
     */
    setUIVisible(visible) {
        if (this.sliderContainer) {
            this.sliderContainer.style.display = visible ? 'flex' : 'none';
        }
    }

    /**
     * Keyboard shortcut: cycle through times with [ and ] keys
     */
    handleKeyboard(keyCode) {
        const currentIndex = this.times.findIndex(t => t.id === this.activeTimeId);

        if (keyCode === 'BracketLeft') {
            // Previous time
            const newIndex = Math.max(0, currentIndex - 1);
            if (newIndex !== currentIndex) {
                this.switchToTime(this.times[newIndex].id);
            }
        } else if (keyCode === 'BracketRight') {
            // Next time
            const newIndex = Math.min(this.times.length - 1, currentIndex + 1);
            if (newIndex !== currentIndex) {
                this.switchToTime(this.times[newIndex].id);
            }
        }
    }
}
