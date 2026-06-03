// Vercel serverless entry point.
//
// Vercel routes every /api/* request to this catch-all function with the
// original URL path preserved, so we simply hand the request to the same
// Express app used for local dev and Railway — it already defines all the
// /api/... routes. No separate backend or VITE_API_URL needed: the frontend
// (served as static files from client/dist) and this function live on the same
// Vercel origin, so the client's relative "/api" calls just work everywhere.
module.exports = require('../server/index.js');
