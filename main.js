import * as pc from 'playcanvas';
import { CollisionSystem } from './collision-system.js';
import { checkWallCollision, clearAllWalls, addWallSegment } from './wall-system.js';
import { WallEditor } from './wall-editor.js';
import { PortalSystem } from './portal-system.js';
import { TimeToggleSystem } from './time-toggle-system.js';
import { config, isMobile } from './config.js';

// Hide loading screen once scene is ready
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

// Update loading progress
function updateProgress(message) {
    document.getElementById('loading-progress').textContent = message;
}

// Wait for Ammo.js to initialize before starting PlayCanvas
async function initializeApp() {
    updateProgress('Initializing physics engine...');

    // Wait for Ammo.js WASM to initialize
    if (typeof Ammo === 'function') {
        try {
            await Ammo();
            updateProgress('Physics engine ready!');
        } catch (err) {
            console.error('Failed to initialize Ammo.js:', err);
            updateProgress('Warning: Physics engine failed to load');
        }
    } else {
        console.warn('Ammo.js not loaded - collision detection will not work');
        updateProgress('Warning: Physics engine not available');
    }

    updateProgress('Starting PlayCanvas...');

    // Create PlayCanvas application
    const canvas = document.createElement('canvas');
    document.getElementById('canvas-container').appendChild(canvas);

    const app = new pc.Application(canvas, {
        mouse: new pc.Mouse(canvas),
        keyboard: new pc.Keyboard(window),
        graphicsDeviceOptions: {
            antialias: false,
            devicePixelRatio: 0.9
        }
    });

    // Set canvas to fill the window
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener('resize', () => app.resizeCanvas());

    // Create camera entity
    const camera = new pc.Entity('camera');
    camera.addComponent('camera', {
        clearColor: new pc.Color(0, 0, 0),
        farClip: 1000,
        nearClip: 0.1,
        fov: config.fov
    });

    // Check for saved position for THIS scene in localStorage
    // (saved when user left this scene via portal - allows returning to same spot)
    let spawnOverride = null;
    try {
        const sceneName = config.sceneName || 'unknown';

        // Update aerialReturnLocation so "Aerial View" button returns to THIS scene
        // This is important when arriving via portal - ensures aerial goes to current scene, not previous
        localStorage.setItem('aerialReturnLocation', sceneName);

        const scenePositions = JSON.parse(localStorage.getItem('scenePositions') || '{}');
        if (scenePositions[sceneName]) {
            spawnOverride = scenePositions[sceneName];
            console.log(`Returning to saved position for ${sceneName}:`, spawnOverride);
        }
    } catch (e) {
        console.warn('Could not read scene positions from localStorage:', e);
    }

    const startPosition = spawnOverride
        ? new pc.Vec3(spawnOverride.x, spawnOverride.y, spawnOverride.z)
        : new pc.Vec3(config.startPosition.x, config.startPosition.y, config.startPosition.z);
    const startRotation = spawnOverride && spawnOverride.pitch !== undefined
        ? new pc.Vec3(spawnOverride.pitch, spawnOverride.yaw, 0)
        : new pc.Vec3(config.startRotation.x, config.startRotation.y, config.startRotation.z);

    // Create Portal layer that renders AFTER gsplat (World Transparent)
    // This ensures the portal orb always renders on top of the gaussian splat
    const portalLayer = new pc.Layer({ name: 'Portal' });

    // Get layer composition and add portal layer after World Transparent
    const layers = app.scene.layers;
    const worldLayer = layers.getLayerByName('World');

    if (worldLayer) {
        // Push the portal layer's transparent sublayer after World transparent
        // This ensures it renders after all gsplat content
        layers.pushTransparent(portalLayer);

        // Also add camera to render this layer
        camera.camera.layers = camera.camera.layers.concat([portalLayer.id]);

        console.log('Portal layer created and added after World Transparent');
    } else {
        console.warn('World layer not found, portal may have occlusion issues');
    }

    camera.setPosition(startPosition);
    camera.setEulerAngles(startRotation);
    app.root.addChild(camera);

    // Movement state
    const keys = {};
    const moveSpeed = config.moveSpeed;
    const maxMoveSpeed = config.maxMoveSpeed;
    const turnSpeed = config.turnSpeed;

    let mouseX = 0, mouseY = 0, isMouseDown = false;
    let pitch = startRotation.x;
    let yaw = startRotation.y;

    // Expose camera rotation for portal-system to save accurately
    window.getCameraRotation = () => ({ pitch, yaw });

    // Wall collision toggle
    let wallCollisionEnabled = true;

    // Movement state for joystick and mobile buttons
    const movement = {
        forward: 0,
        right: 0,
        up: false,
        down: false
    };

    const smoothMovement = {
        forward: 0,
        right: 0
    };

    // Touch controls for camera rotation on canvas
    let canvasTouchId = null;
    let touchStartX = 0;
    let touchStartY = 0;

    canvas.addEventListener('touchstart', (e) => {
        // Only handle touches on canvas (not on joystick/buttons)
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (canvasTouchId === null) {
                canvasTouchId = touch.identifier;
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                e.preventDefault();
                break;
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (canvasTouchId === null) return;

        for (let i = 0; i < e.touches.length; i++) {
            const touch = e.touches[i];
            if (touch.identifier === canvasTouchId) {
                e.preventDefault();

                const deltaX = touch.clientX - touchStartX;
                const deltaY = touch.clientY - touchStartY;

                yaw -= deltaX * 0.15;
                pitch -= deltaY * 0.15;
                pitch = pc.math.clamp(pitch, -85, 85);

                camera.setEulerAngles(pitch, yaw, 0);

                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                break;
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === canvasTouchId) {
                canvasTouchId = null;
                e.preventDefault();
                break;
            }
        }
    }, { passive: false });

    // Mobile controls setup
    function setupMobileControls() {
        const joystick = document.getElementById('joystick');
        const stick = document.getElementById('joystick-stick');

        if (!joystick || !stick) return;

        let isDragging = false;
        let joystickCenter = { x: 50, y: 50 };  // 100px / 2
        let maxDistance = 30;
        let joystickVector = { x: 0, y: 0 };

        // Continuous movement with smoothing
        function updateJoystickMovement() {
            let x = joystickVector.x;
            let y = joystickVector.y;

            const deadZone = 0.15;
            const magnitude = Math.sqrt(x * x + y * y);

            if (magnitude < deadZone) {
                x = 0;
                y = 0;
            } else {
                const scale = (magnitude - deadZone) / (1 - deadZone);
                x = (x / magnitude) * scale;
                y = (y / magnitude) * scale;
            }

            const sensitivity = config.mobileSensitivity;
            x *= sensitivity;
            y *= sensitivity;

            // Smooth interpolation
            const smoothFactor = 0.25;
            smoothMovement.forward = smoothMovement.forward * (1 - smoothFactor) + (-y) * smoothFactor;
            smoothMovement.right = smoothMovement.right * (1 - smoothFactor) + x * smoothFactor;

            movement.forward = smoothMovement.forward;
            movement.right = smoothMovement.right;

            requestAnimationFrame(updateJoystickMovement);
        }

        updateJoystickMovement();

        function handleJoystickStart(e) {
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            stick.classList.add('active');

            if (e.touches && e.touches.length > 0) {
                handleJoystickMove(e);
            }
        }

        function handleJoystickMove(e) {
            if (!isDragging) return;
            e.preventDefault();
            e.stopPropagation();

            const touch = e.touches ? e.touches[0] : e;
            const rect = joystick.getBoundingClientRect();
            const x = (touch.clientX - rect.left) - joystickCenter.x;
            const y = (touch.clientY - rect.top) - joystickCenter.y;

            const distance = Math.sqrt(x * x + y * y);

            let finalX = x;
            let finalY = y;

            if (distance > maxDistance) {
                const angle = Math.atan2(y, x);
                finalX = Math.cos(angle) * maxDistance;
                finalY = Math.sin(angle) * maxDistance;
            }

            stick.style.transform = `translate(${finalX}px, ${finalY}px)`;

            joystickVector.x = finalX / maxDistance;
            joystickVector.y = finalY / maxDistance;
        }

        function handleJoystickEnd(e) {
            e.preventDefault();
            e.stopPropagation();
            isDragging = false;
            stick.classList.remove('active');
            stick.style.transform = 'translate(-50%, -50%)';
            joystickVector.x = 0;
            joystickVector.y = 0;
        }

        // Touch events
        joystick.addEventListener('touchstart', handleJoystickStart, { passive: false });
        document.addEventListener('touchmove', (e) => {
            if (isDragging) handleJoystickMove(e);
        }, { passive: false });
        document.addEventListener('touchend', (e) => {
            if (isDragging) handleJoystickEnd(e);
        }, { passive: false });

        // Mouse events for desktop testing
        stick.addEventListener('mousedown', handleJoystickStart);
        document.addEventListener('mousemove', handleJoystickMove);
        document.addEventListener('mouseup', handleJoystickEnd);

        // Vertical movement buttons
        const upBtn = document.getElementById('mobile-up-btn');
        const downBtn = document.getElementById('mobile-down-btn');

        if (upBtn && downBtn) {
            upBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                movement.up = true;
            }, { passive: false });

            upBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                movement.up = false;
            }, { passive: false });

            downBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                movement.down = true;
            }, { passive: false });

            downBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                movement.down = false;
            }, { passive: false });

            // Mouse events for desktop testing
            upBtn.addEventListener('mousedown', () => movement.up = true);
            upBtn.addEventListener('mouseup', () => movement.up = false);
            upBtn.addEventListener('mouseleave', () => movement.up = false);

            downBtn.addEventListener('mousedown', () => movement.down = true);
            downBtn.addEventListener('mouseup', () => movement.down = false);
            downBtn.addEventListener('mouseleave', () => movement.down = false);
        }

        // Show mobile navigation popup briefly
        const popup = document.getElementById('mobile-nav-popup');
        if (popup) {
            popup.classList.add('show');
            setTimeout(() => {
                popup.classList.remove('show');
                popup.classList.add('hide');
                setTimeout(() => {
                    popup.style.display = 'none';
                }, 300);
            }, 3000);
        }
    }

    // Initialize mobile controls if on mobile
    if (isMobile()) {
        setupMobileControls();
    }

    // Keyboard events
    window.addEventListener('keydown', (e) => {
        if (!e.repeat) {
            keys[e.code] = true;
        }

        // Reset position (R key)
        if (e.key === 'r' || e.key === 'R') {
            camera.setPosition(startPosition);
            camera.setEulerAngles(startRotation);
            pitch = startRotation.x;
            yaw = startRotation.y;
        }

        // Toggle debug panel (U key) - works anytime
        if (e.key === 'u' || e.key === 'U') {
            const posEl = document.getElementById('pos');
            const rotEl = document.getElementById('rot');
            if (posEl && rotEl) {
                const isVisible = posEl.style.display === 'block';
                posEl.style.display = isVisible ? 'none' : 'block';
                rotEl.style.display = isVisible ? 'none' : 'block';
            }
        }

        // DEBUG KEYBOARD SHORTCUTS (F, V, C, B keys - only in debug mode)
        if (config.debug) {
            // Toggle wall editor (F key)
            if (e.key === 'f' || e.key === 'F') {
                wallEditor.toggleEditor();
            }

            // Wall Editor controls
            if (wallEditor.active) {
                if (e.key === 'g' || e.key === 'G') wallEditor.setMode('move');
                if (e.key === 'n' || e.key === 'N') wallEditor.setMode('add');
                if (e.key === 't' || e.key === 'T') wallEditor.setMode('split');
                if (e.key === 'x' || e.key === 'X') wallEditor.setMode('delete');
                if (e.key === 'p' || e.key === 'P') wallEditor.saveWalls();

                // Space key to place node in Add mode
                if (e.key === ' ' || e.code === 'Space') {
                    if (wallEditor.mode === 'add') {
                        e.preventDefault();
                        wallEditor.placeNodeAtCamera();
                    }
                }
            }
            // Toggle collision mesh visibility (V key)
            if (e.key === 'v' || e.key === 'V') {
                collisionSystem.toggleVisibility();
            }

            // Toggle collision detection (C key)
            if (e.key === 'c' || e.key === 'C') {
                collisionSystem.toggleCollision();
            }

            // Toggle wall collision (B key)
            if (e.key === 'b' || e.key === 'B') {
                wallCollisionEnabled = !wallCollisionEnabled;
                console.log('Wall collision:', wallCollisionEnabled ? 'ENABLED' : 'DISABLED');
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });

    // Mouse look controls
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            // Left click
            if (wallEditor.active) {
                // Wall editor: handle click for editing
                wallEditor.handleClick(e);
            } else {
                // Normal camera rotation
                isMouseDown = true;
                mouseX = e.clientX;
                mouseY = e.clientY;
            }
        } else if (e.button === 2) {
            // Right click: always allow camera rotation (even in editor)
            isMouseDown = true;
            mouseX = e.clientX;
            mouseY = e.clientY;
        }
    });

    // Prevent context menu on right-click
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
        isMouseDown = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (isMouseDown) {
            const deltaX = e.clientX - mouseX;
            const deltaY = e.clientY - mouseY;

            yaw -= deltaX * turnSpeed * 50;
            pitch -= deltaY * turnSpeed * 50;
            pitch = pc.math.clamp(pitch, -85, 85);

            camera.setEulerAngles(pitch, yaw, 0);

            mouseX = e.clientX;
            mouseY = e.clientY;
        }
    });

    // Configure LOD settings from config (instead of hardcoded values)
    const sceneLOD = config.sceneLOD || {};
    app.scene.gsplat.lodUpdateAngle = sceneLOD.lodUpdateAngle ?? 90;
    app.scene.gsplat.lodBehindPenalty = sceneLOD.lodBehindPenalty ?? 5;
    app.scene.gsplat.radialSorting = sceneLOD.radialSorting ?? true;
    app.scene.gsplat.lodUpdateDistance = sceneLOD.lodUpdateDistance ?? 0.5;
    app.scene.gsplat.lodUnderfillLimit = sceneLOD.lodUnderfillLimit ?? 15;
    app.scene.gsplat.colorUpdateDistance = sceneLOD.colorUpdateDistance ?? 1;
    app.scene.gsplat.colorUpdateAngle = sceneLOD.colorUpdateAngle ?? 4;
    app.scene.gsplat.colorUpdateDistanceLodScale = sceneLOD.colorUpdateDistanceLodScale ?? 2;
    app.scene.gsplat.colorUpdateAngleLodScale = sceneLOD.colorUpdateAngleLodScale ?? 2;

    const selectedPreset = config.lod[isMobile() ? 'mobile' : 'desktop'];
    app.scene.gsplat.lodRangeMin = selectedPreset.range[0];
    app.scene.gsplat.lodRangeMax = selectedPreset.range[1];
    console.log('LOD range:', selectedPreset.range[0], '-', selectedPreset.range[1]);

    // Expose function for LOD panel to change LOD at runtime
    window.setLodLevel = (level) => {
        app.scene.gsplat.lodRangeMin = level;
        console.log('LOD set to:', level);
    };

    // Sync LOD panel with current value
    if (window.setLodPanelValue) {
        window.setLodPanelValue(selectedPreset.range[0]);
    }

    // Initialize Time Toggle System for multi-temporal splat loading
    let timeToggleSystem = null;

    // Initialize Portal System for inter-scene navigation
    let portalSystem = null;

    // Initialize collision system
    const collisionSystem = new CollisionSystem(app, camera);
    collisionSystem.loadCollisionMesh(config.collisionMesh || './collision.glb');

    // Show collision mesh if configured
    if (config.showColliders) {
        // Wait for mesh to load then toggle
        setTimeout(() => collisionSystem.toggleVisibility(), 1000);
    }

    // Initialize wall editor
    const wallEditor = new WallEditor(app, camera);

    if (config.timeToggle && config.timeToggle.enabled) {
        // Time Toggle mode: load multi-temporal splats
        updateProgress('Loading Gaussian Splat (Time Toggle enabled)...');

        timeToggleSystem = new TimeToggleSystem(app, config);

        timeToggleSystem.initialize().then((splatEntity) => {
            console.log('Time Toggle System initialized, active splat:', splatEntity.name);

            // Apply LOD distances to active splat
            const gs = splatEntity.gsplat;
            if (gs) {
                gs.lodDistances = selectedPreset.lodDistances;
            }

            // Set up keyboard shortcuts for time toggle
            window.addEventListener('keydown', (e) => {
                if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
                    timeToggleSystem.handleKeyboard(e.code);
                }
            });

            // Initialize Portal System after splat is loaded
            if (config.portal && config.portal.enabled) {
                portalSystem = new PortalSystem(app, camera, config, portalLayer);
                console.log('Portal System initialized (with Portal layer for gsplat overlay)');
            }

            hideLoading();
        }).catch((err) => {
            console.error('Error initializing Time Toggle System:', err);
            updateProgress('Error loading splat: ' + err);
        });
    } else {
        // Fallback: load single splat (original behavior)
        updateProgress('Loading Gaussian Splat...');

        const asset = new pc.Asset('scene_splat', 'gsplat', {
            url: './splats/lod-meta.json'
        });

        app.assets.add(asset);

        asset.ready(() => {
            const splatEntity = new pc.Entity('splat');
            splatEntity.addComponent('gsplat', {
                asset: asset,
                layers: [0],
                unified: true
            });

            splatEntity.setEulerAngles(-90, 0, 0);
            app.root.addChild(splatEntity);

            const gs = splatEntity.gsplat;
            if (gs) {
                gs.lodDistances = selectedPreset.lodDistances;
            }

            // Initialize Portal System after splat is loaded
            if (config.portal && config.portal.enabled) {
                portalSystem = new PortalSystem(app, camera, config, portalLayer);
                console.log('Portal System initialized');
            }

            hideLoading();
        });

        asset.on('error', (err) => {
            console.error('Error loading SOG file:', err);
            updateProgress('Error loading splat file: ' + err);
        });

        app.assets.load(asset);
    }

    // Load wall configuration
    async function loadWalls() {
        try {
            const response = await fetch('./wall_config.json');
            if (!response.ok) throw new Error('Failed to load wall config');

            const data = await response.json();
            if (data.segments) {
                clearAllWalls();
                data.segments.forEach(segment => {
                    addWallSegment(segment.start, segment.end, segment.name, segment.color);
                });
                console.log('Loaded walls from config:', data.segments.length);

                // Update editor if active
                if (wallEditor) wallEditor.updateWallList();
            }
        } catch (err) {
            console.warn('Could not load wall_config.json, using defaults:', err);
        }
    }

    loadWalls();

    // Fly Mode state
    let flyMode = false;

    // Movement update loop
    app.on('update', (dt) => {
        // Scale speed by dt for frame-rate independent movement
        const moveSpeedDt = (keys['ShiftLeft'] ? maxMoveSpeed : moveSpeed) * dt * 60; // * 60 to maintain relative speed tuning

        const forward = camera.forward.clone();
        const right = camera.right.clone();

        if (!flyMode) {
            // Walk mode: constrain to horizontal plane
            forward.y = 0;
            forward.normalize();
            right.y = 0;
            right.normalize();
        }

        const currentPos = camera.getPosition().clone();
        const newPos = currentPos.clone();

        // Keyboard movement
        if (keys['KeyW']) {
            newPos.add(forward.clone().mulScalar(moveSpeedDt));
        }
        if (keys['KeyS']) {
            newPos.sub(forward.clone().mulScalar(moveSpeedDt));
        }
        if (keys['KeyA']) {
            newPos.sub(right.clone().mulScalar(moveSpeedDt));
        }
        if (keys['KeyD']) {
            newPos.add(right.clone().mulScalar(moveSpeedDt));
        }

        // Joystick movement
        if (movement.forward !== 0 || movement.right !== 0) {
            newPos.add(forward.clone().mulScalar(moveSpeedDt * movement.forward));
            newPos.add(right.clone().mulScalar(moveSpeedDt * movement.right));
        }

        // Vertical movement
        if (flyMode) {
            // In fly mode, Q/E move up/down relative to world
            if (keys['KeyQ']) newPos.y = Math.min(newPos.y + moveSpeedDt, config.maxY);
            if (keys['KeyE']) newPos.y -= moveSpeedDt;
        } else {
            // In walk mode, Q/E are debug height adjustments (optional)
            if (keys['KeyQ'] || movement.up) newPos.y = Math.min(newPos.y + moveSpeedDt * 0.5, config.maxY);
            if (keys['KeyE'] || movement.down) newPos.y -= moveSpeedDt * 0.5;
        }

        // Check for collision before applying movement
        // Disable collision in Fly Mode for easier editing
        if (!flyMode) {
            // 1. Physics Collision (Mesh)
            if (collisionSystem.checkCollision(currentPos, newPos)) {
                // Reset smooth movement on collision (prevents mobile joystick drift)
                smoothMovement.forward = 0;
                smoothMovement.right = 0;
                return;
            }

            // 2. Virtual Wall Boundary Collision
            if (wallCollisionEnabled && checkWallCollision(currentPos, newPos)) {
                smoothMovement.forward = 0;
                smoothMovement.right = 0;
                // For virtual walls, we just stop for now (could implement sliding here too later)
                return;
            }

            // 3. Portal Collision (can't walk through portal)
            if (portalSystem && portalSystem.checkMovementBlocked(currentPos, newPos)) {
                smoothMovement.forward = 0;
                smoothMovement.right = 0;
                return;
            }
        }

        camera.setPosition(newPos);

        // Update portal system (UI positioning) and check collision
        if (portalSystem) {
            portalSystem.update(dt);
            portalSystem.checkCollision(camera.getPosition());
        }

        // Update position and rotation display (always update values, U key toggles visibility)
        // Use internal pitch/yaw variables, not camera.getEulerAngles() which can have gimbal issues
        const pos = camera.getPosition();
        const posEl = document.getElementById('pos');
        const rotEl = document.getElementById('rot');
        if (posEl) {
            posEl.textContent = `${flyMode ? '[FLY] ' : ''}${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
        }
        if (rotEl) {
            rotEl.textContent = `${pitch.toFixed(1)}, ${yaw.toFixed(1)}, 0`;
        }
    });

    // Test runtime LOD change (L key)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'l' || e.key === 'L') {
            const currentLod = app.scene.gsplat.lodRangeMin;
            const newLod = (currentLod + 1) % 6;
            app.scene.gsplat.lodRangeMin = newLod;
            console.log('LOD changed:', currentLod, '→', newLod);

            // Visual feedback
            const feedback = document.createElement('div');
            feedback.textContent = `LOD: ${newLod}`;
            feedback.style.cssText = `
                position: fixed;
                top: 20%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.7);
                color: #fff;
                padding: 10px 20px;
                border-radius: 5px;
                font-weight: bold;
                pointer-events: none;
                z-index: 2000;
            `;
            document.body.appendChild(feedback);
            setTimeout(() => feedback.remove(), 1000);

            // Sync panel if it exists
            if (window.setLodPanelValue) {
                window.setLodPanelValue(newLod);
            }
        }
    });

    // Toggle Fly Mode (O key)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'o' || e.key === 'O') {
            flyMode = !flyMode;
            console.log('Fly Mode:', flyMode ? 'ENABLED' : 'DISABLED');

            // Visual feedback
            const feedback = document.createElement('div');
            feedback.textContent = flyMode ? 'FLY MODE' : 'WALK MODE';
            feedback.style.cssText = `
                position: fixed;
                top: 20%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.7);
                color: #fff;
                padding: 10px 20px;
                border-radius: 5px;
                font-weight: bold;
                pointer-events: none;
                z-index: 2000;
            `;
            document.body.appendChild(feedback);
            setTimeout(() => feedback.remove(), 1000);
        }
    });

    // Alignment adjustment mode (T key to toggle, then numpad to adjust)
    // Only active when timeToggle is enabled - for ICP alignment tuning
    let alignmentMode = false;
    let alignOffset = { x: 0, y: 0, z: 0 };
    let alignRotY = 0;

    window.addEventListener('keydown', (e) => {
        // Only enable alignment mode for time toggle scenes
        if (!timeToggleSystem) return;

        // T key toggles alignment mode
        if (e.key === 't' || e.key === 'T') {
            alignmentMode = !alignmentMode;
            const feedback = document.createElement('div');
            feedback.textContent = alignmentMode ? 'ALIGNMENT MODE ON\n4/6=X, 2/8=Z, -/+=Y, 7/9=Rot' : 'ALIGNMENT MODE OFF';
            feedback.style.cssText = `
                position: fixed; top: 30%; left: 50%; transform: translate(-50%, -50%);
                background: ${alignmentMode ? 'rgba(255, 100, 0, 0.9)' : 'rgba(0, 0, 0, 0.7)'};
                color: #fff; padding: 15px 25px; border-radius: 5px; font-weight: bold;
                pointer-events: none; z-index: 2000; white-space: pre-line; text-align: center;
            `;
            document.body.appendChild(feedback);
            setTimeout(() => feedback.remove(), 2000);
            return;
        }

        if (!alignmentMode) return;

        const step = e.shiftKey ? 0.5 : 0.1; // Shift for bigger steps
        const rotStep = e.shiftKey ? 2 : 0.5;
        let changed = false;

        switch(e.key) {
            case '4': alignOffset.x -= step; changed = true; break;
            case '6': alignOffset.x += step; changed = true; break;
            case '8': alignOffset.z -= step; changed = true; break;
            case '2': alignOffset.z += step; changed = true; break;
            case '-': alignOffset.y -= step; changed = true; break;
            case '=': case '+': alignOffset.y += step; changed = true; break;
            case '7': alignRotY -= rotStep; changed = true; break;
            case '9': alignRotY += rotStep; changed = true; break;
        }

        if (changed && timeToggleSystem) {
            // Get the secondary (non-primary) time state to adjust
            const secondaryTimeId = timeToggleSystem.times.find(t => t.id !== timeToggleSystem.times[0].id)?.id;
            const entity = timeToggleSystem.splatEntities[secondaryTimeId];

            if (entity) {
                // Build new transform with adjusted values
                const radY = alignRotY * Math.PI / 180;
                const cosY = Math.cos(radY), sinY = Math.sin(radY);

                // Rotation matrix (Y rotation in Z-up, combined with -90 X for Y-up)
                const zToY = new pc.Mat4();
                zToY.setFromEulerAngles(-90, 0, 0);

                const alignMat = new pc.Mat4();
                // Simple Y-rotation + translation for testing
                alignMat.set([
                    cosY, sinY, 0, 0,
                    -sinY, cosY, 0, 0,
                    0, 0, 1, 0,
                    alignOffset.x, alignOffset.y, alignOffset.z, 1
                ]);

                const combined = new pc.Mat4();
                combined.copy(zToY);
                combined.mul(alignMat);

                const pos = new pc.Vec3();
                combined.getTranslation(pos);
                const rot = new pc.Quat();
                rot.setFromMat4(combined);

                entity.setLocalPosition(pos);
                entity.setLocalRotation(rot);

                console.log(`Align: X=${alignOffset.x.toFixed(2)}, Y=${alignOffset.y.toFixed(2)}, Z=${alignOffset.z.toFixed(2)}, RotY=${alignRotY.toFixed(1)}°`);
            }
        }
    });

    // DEBUG - Update FPS display
    let lastTime = performance.now();
    let frames = 0;
    let fps = 60;

    app.on('update', () => {
        // Always update FPS if element exists
        frames++;
        const currentTime = performance.now();
        const elapsed = currentTime - lastTime;

        if (elapsed >= 1000) {
            fps = Math.round((frames * 1000) / elapsed);
            const fpsEl = document.getElementById('fps');
            if (fpsEl) {
                fpsEl.textContent = fps;
            }
            // Update LOD panel FPS display
            if (window.updateLodFps) {
                window.updateLodFps(fps);
            }
            // Update mobile FPS counter
            const mobileFpsEl = document.getElementById('mobile-fps');
            if (mobileFpsEl) {
                mobileFpsEl.textContent = `FPS: ${fps} | LOD: ${app.scene.gsplat.lodRangeMin}`;
            }
            frames = 0;
            lastTime = currentTime;
        }
    });

    // Click-to-copy coordinates
    if (config.debug) {
        const posEl = document.getElementById('pos');
        if (posEl) {
            posEl.addEventListener('click', async () => {
                const coords = posEl.textContent;
                try {
                    await navigator.clipboard.writeText(coords);

                    // Visual feedback - briefly change text
                    const originalText = posEl.textContent;
                    posEl.textContent = 'Copied!';
                    posEl.style.background = 'rgba(0, 255, 0, 0.5)';

                    setTimeout(() => {
                        posEl.textContent = originalText;
                        posEl.style.background = '';
                    }, 500);

                    console.log('Position copied to clipboard:', coords);
                } catch (err) {
                    console.error('Failed to copy coordinates:', err);
                }
            });
        }
    }

    // Start the application
    app.start();
}

// Start initialization
initializeApp();
