import express, { type Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import fs from "fs/promises";

async function collectImageFiles(dirPath: string, publicBasePath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const publicPath = `${publicBasePath}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...await collectImageFiles(fullPath, publicPath));
      continue;
    }

    if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name)) {
      files.push(publicPath);
    }
  }

  return files;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve the local plant-health directory for diagnostic processing
  app.use("/local-dataset", express.static(path.resolve(process.cwd(), "plant-health")));

  // Serve the specific custom healthy dataset if it exists
  app.get("/api/dataset/custom-csv", async (_req, res) => {
    try {
      const csvPath = path.resolve(process.cwd(), "healthy dataset.csv");
      const content = await fs.readFile(csvPath, "utf-8");
      res.json({ content, filename: "healthy dataset.csv" });
    } catch (e) {
      res.status(404).json({ error: "Custom dataset not found" });
    }
  });

  // Endpoint to scan and return available local images for client-side processing
  app.get("/api/dataset/local-files", async (_req, res) => {
    try {
      const rootDir = path.resolve(process.cwd(), "plant-health");
      const categories = ["healthy", "unhealthy"];
      const files: { path: string; category: string }[] = [];

      for (const cat of categories) {
        const catDir = path.join(rootDir, cat);
        try {
          const stats = await fs.stat(catDir);
          if (stats.isDirectory()) {
            const dirFiles = await collectImageFiles(catDir, `/local-dataset/${cat}`);
            for (const file of dirFiles) {
                files.push({
                  path: file,
                  category: cat === "healthy" ? "Healthy" : ""
                });
            }
          }
        } catch (e) {
          console.warn(`Category directory ${cat} not found or inaccessible`);
        }
      }

      res.json({ files });
    } catch (error) {
      console.error("Local sync error:", error);
      res.status(500).json({ error: "Failed to list local files" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
