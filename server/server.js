import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { searchHotels } from "./services/hotelAgent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const envFilePath = path.join(__dirname, "..", ".env");
const vendorFiles = {
  "/vendor/react.js": path.join(__dirname, "..", "node_modules", "react", "umd", "react.development.js"),
  "/vendor/react-dom.js": path.join(__dirname, "..", "node_modules", "react-dom", "umd", "react-dom.development.js")
};

async function loadEnvFile(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");

    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

await loadEnvFile(envFilePath);

const port = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function serveStaticFile(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (vendorFiles[requestUrl.pathname]) {
    try {
      const file = await readFile(vendorFiles[requestUrl.pathname]);
      response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      response.end(file);
      return;
    } catch {
      sendJson(response, 404, { error: "Vendor asset not found" });
      return;
    }
  }

  const relativePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    const extension = path.extname(filePath);
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    response.end(file);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && request.url === "/api/search") {
      const body = await parseRequestBody(request);
      const query = String(body.query || "").trim();
      const preferences = typeof body.preferences === "object" && body.preferences !== null ? body.preferences : {};
      const hasStructuredSelections = Boolean(
        preferences.trip_type ||
          (Array.isArray(preferences.amenities) && preferences.amenities.length) ||
          (Array.isArray(preferences.experience) && preferences.experience.length) ||
          (Array.isArray(preferences.location_type) && preferences.location_type.length)
      );

      if (!query && !hasStructuredSelections) {
        sendJson(response, 400, { error: "Add a search query or select at least one preference." });
        return;
      }

      const result = await searchHotels(query, preferences);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET") {
      await serveStaticFile(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, {
      error: "Something went wrong while processing the request.",
      detail: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

server.listen(port, () => {
  console.log(`AI Hotel Discovery Agent running at http://localhost:${port}`);
});
