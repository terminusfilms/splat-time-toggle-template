/**
 * Collision System for PlayCanvas
 * Uses physics-based collision detection with invisible collision mesh
 */

import * as pc from 'playcanvas';

export class CollisionSystem {
    constructor(app, camera) {
        this.app = app;
        this.camera = camera;
        this.collisionMesh = null;
        this.collisionEnabled = false; // Start disabled, enable after mesh loads
        this.debugVisible = false;
        this.physicsReady = false; // Track if physics system is working

        // Camera collision sphere settings
        this.collisionRadius = 0.3; // 30cm radius around camera

        // Reusable Vec3 to avoid GC pressure (checkCollision called 60+ times/sec)
        this._direction = new pc.Vec3();
    }

    /**
     * Load collision mesh from GLB file
     */
    loadCollisionMesh(url) {
        const collisionAsset = new pc.Asset('collision_mesh', 'container', {
            url: url
        });

        this.app.assets.add(collisionAsset);

        collisionAsset.ready(() => {
            this._setupCollisionMesh(collisionAsset);
        });

        collisionAsset.on('error', (err) => {
            console.error('Error loading collision mesh:', err);
        });

        this.app.assets.load(collisionAsset);
    }

    /**
     * Setup collision mesh with physics components
     */
    _setupCollisionMesh(asset) {
        const resource = asset.resource;
        const model = resource.instantiateRenderEntity();

        // GLB collision mesh aligned at 0° rotation (matches splat at -90°)
        model.setEulerAngles(0, 0, 0);


        // Find all render components and add collision
        let colliderCount = 0;
        model.findComponents('render').forEach((renderComp) => {
            const entity = renderComp.entity;

            // Skip if no render component
            if (!entity.render) {
                return;
            }

            // Add collision component directly to the entity
            entity.addComponent('collision', {
                type: 'mesh',
                renderAsset: entity.render.asset
            });

            // Add static rigidbody for physics
            entity.addComponent('rigidbody', {
                type: 'static',
                restitution: 0,
                friction: 0.5
            });

            colliderCount++;

            // Keep render for debugging but hide it

            // Set material for debug visualization
            if (entity.render) {
                entity.render.meshInstances.forEach(mi => {
                    const material = new pc.StandardMaterial();
                    material.diffuse = new pc.Color(0, 1, 0); // Green
                    material.opacity = 0.3;
                    material.blendType = pc.BLEND_NORMAL;
                    material.update();
                    mi.material = material;
                });

                // Start invisible
                entity.render.enabled = false;
            }
        });

        this.app.root.addChild(model);
        this.collisionMesh = model;

        // Ammo is already initialized by main.js - just test if physics is ready
        // Give it a moment for PlayCanvas to set up the physics system
        setTimeout(() => this._testPhysicsReady(), 100);
        setTimeout(() => this._testPhysicsReady(), 500);
        setTimeout(() => this._testPhysicsReady(), 1000);

    }

    /**
     * Test if physics system is working and enable collision
     */
    _testPhysicsReady() {
        // Skip if already enabled
        if (this.physicsReady) return;

        if (!this.app.systems.rigidbody || !this.collisionMesh) {
            console.warn('Rigidbody system or collision mesh not ready');
            return;
        }

        // Check if physics world is initialized
        if (!this.app.systems.rigidbody.dynamicsWorld) {
            console.warn('Physics dynamics world not initialized yet, retrying...');
            // Retry after a short delay
            setTimeout(() => this._testPhysicsReady(), 100);
            return;
        }


        try {
            // Test raycast
            const testStart = new pc.Vec3(0, 1, 0);
            const testEnd = new pc.Vec3(0, 0, 0);
            const result = this.app.systems.rigidbody.raycastFirst(testStart, testEnd);

            // Physics is working!
            this.physicsReady = true;
            this.collisionEnabled = true;
        } catch (err) {
            console.warn('Raycast test failed:', err.message);
            console.warn('Full error:', err);
            this.physicsReady = false;
        }
    }

    /**
     * Check if movement would cause collision
     * Returns true if movement is blocked
     */
    checkCollision(currentPos, newPos) {
        // Return false if collision disabled, mesh not loaded, physics not ready
        if (!this.collisionEnabled || !this.collisionMesh || !this.physicsReady) {
            return false; // No collision
        }

        // Use raycast from current to new position (reuse Vec3 to avoid GC)
        this._direction.sub2(newPos, currentPos);
        const distance = this._direction.length();

        if (distance === 0) return false;

        this._direction.normalize();

        try {
            // Raycast with padding for camera collision sphere
            const result = this.app.systems.rigidbody.raycastFirst(
                currentPos,
                newPos
            );

            if (result && result.entity) {
                // Hit something - check if it's far enough
                const hitDistance = result.point.distance(currentPos);

                // If hit is closer than our collision radius, block movement
                if (hitDistance < this.collisionRadius) {
                    return true;
                }
            }
        } catch (err) {
            console.error('Raycast error:', err);
            return false; // Don't block movement on error
        }

        return false;
    }

    /**
     * Toggle collision mesh visibility for debugging
     */
    toggleVisibility() {
        if (!this.collisionMesh) return;

        this.debugVisible = !this.debugVisible;

        this.collisionMesh.findComponents('render').forEach((renderComp) => {
            if (renderComp.entity && renderComp.entity.render) {
                renderComp.entity.render.enabled = this.debugVisible;
            }
        });

    }

    /**
     * Toggle collision detection on/off
     */
    toggleCollision() {
        this.collisionEnabled = !this.collisionEnabled;
    }

    /**
     * Get collision status for UI display
     */
    getStatus() {
        return {
            enabled: this.collisionEnabled,
            visible: this.debugVisible,
            loaded: this.collisionMesh !== null
        };
    }
}
