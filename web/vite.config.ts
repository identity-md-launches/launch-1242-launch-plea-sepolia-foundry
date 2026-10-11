import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { framework: ["react", "react-dom"], ethereum: ["viem"] },
      },
    },
  },
});
