import { defineConfig } from 'vite';

export default defineConfig({
    base: './',  // Relative base path for any subdirectory
    server: {
        port: 5182,  // Use 5182 to avoid conflicts with production version
        open: true
    },
    build: {
        outDir: 'dist',
        assetsInlineLimit: 0, // Don't inline assets
        rollupOptions: {
            output: {
                manualChunks: undefined
            }
        }
    }
});
