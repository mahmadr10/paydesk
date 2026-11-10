let app = null;
let loadError = null;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Cookie"
  );
  res.setHeader("Access-Control-Expose-Headers", "Set-Cookie");
}

function getApp() {
  if (app) return app;
  if (loadError) throw loadError;
  try {
    const { createApp } = require("../dist/app");
    app = createApp();
    return app;
  } catch (err) {
    loadError = err;
    throw err;
  }
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const appInstance = getApp();
    return new Promise((resolve, reject) => {
      res.on("finish", resolve);
      res.on("close", resolve);
      res.on("error", reject);
      appInstance(req, res);
    });
  } catch (error) {
    console.error("Vercel Serverless Function Startup Error:", error);
    setCorsHeaders(req, res);
    return res.status(500).json({
      success: false,
      error: error?.message || "Server initialization failed",
      details: error?.stack || String(error),
    });
  }
};

module.exports.app = getApp;
