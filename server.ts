import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";
import { readFileSync } from "fs";

dotenv.config();

// Initialize Firebase Admin
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(readFileSync(configPath, "utf-8"));

if (getApps().length === 0) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = getFirestore();
db.settings({ databaseId: firebaseConfig.firestoreDatabaseId });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // --- Utility Lookups (DNI/RUC) ---
  app.get("/api/lookup/dni/:dni", async (req, res) => {
    const { dni } = req.params;
    const token = process.env.APIS_PERU_TOKEN;

    if (!token) {
      return res.status(500).json({ error: "APIS_PERU_TOKEN not configured" });
    }

    try {
      const response = await fetch(`https://dniruc.apisperu.com/api/v1/dni/${dni}?token=${token}`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("DNI Lookup Error:", error);
      res.status(500).json({ error: "Failed to lookup DNI" });
    }
  });

  // API Route for RUC Lookup
  app.get("/api/lookup/ruc/:ruc", async (req, res) => {
    const { ruc } = req.params;
    const token = process.env.APIS_PERU_TOKEN;

    if (!token) {
      return res.status(500).json({ error: "APIS_PERU_TOKEN not configured" });
    }

    try {
      const response = await fetch(`https://dniruc.apisperu.com/api/v1/ruc/${ruc}?token=${token}`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("RUC Lookup Error:", error);
      res.status(500).json({ error: "Failed to lookup RUC" });
    }
  });

  // API Route for receipt image analysis with Gemini AI
  app.post("/api/gemini/analyze-receipt", async (req, res) => {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Falta la imagen del recibo" });
    }

    try {
      const matches = image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: "Formato de imagen inválido. Debe ser una URI base64." });
      }

      const mimeType = matches[1];
      const base64Data = matches[2];

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            }
          },
          {
            text: "Extrae de la imagen del recibo, comprobante, boleta o factura de gastos un JSON con los siguientes campos obligatorios: monto (número con punto decimal), item (string resumido de lo comprado/gastado), cantidad (número de los elementos comprados, por defecto 1 si no se detalla), proveedor (string del nombre comercial del vendedor o de la tienda)."
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              monto: {
                type: Type.NUMBER,
                description: "El monto total de la transacción en formato numérico"
              },
              item: {
                type: Type.STRING,
                description: "Descripción resumida de lo que se compró o pagó"
              },
              cantidad: {
                type: Type.NUMBER,
                description: "La cantidad comprada"
              },
              proveedor: {
                type: Type.STRING,
                description: "Nombre de la tienda, negocio, o persona que recibe el pago"
              }
            },
            required: ["monto", "item", "cantidad", "proveedor"]
          }
        }
      });

      const text = response.text || "{}";
      const parsedData = JSON.parse(text);
      res.json(parsedData);
    } catch (error: any) {
      console.error("Error al analizar recibo con Gemini:", error);
      res.status(500).json({ error: "Error al procesar recibo con IA: " + (error?.message || error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
