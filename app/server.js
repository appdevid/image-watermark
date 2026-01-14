// server.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require("express");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(bodyParser.json({ limit: "20mb" }));

// ----- start untuk water mark -----
const multer = require('multer');
const sharp = require('sharp');


const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});
// ----- end untuk water mark -----

// ----- Configuration via environment variables -----
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3021;
const BASIC_USER = process.env.BASIC_AUTH_USER || "admin";
const BASIC_PASS = process.env.BASIC_AUTH_PASS || "password";
// ALLOWED_IPS can be "*" or comma separated list of exact IPs or prefixes (e.g. "10.0.,192.168.1.,1.2.3.4")
const ALLOWED_IPS = (process.env.ALLOWED_IPS || "*").split(",").map(s => s.trim()).filter(Boolean);

// ----- Helpers -----
function getClientIp(req) {
    // Try X-Forwarded-For first (may contain comma list)
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        // take first IP in list
        const first = xff.split(",")[0].trim();
        return normalizeIp(first);
    }
    // fallback to connection remote address
    const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
    return normalizeIp(remote);
}

function normalizeIp(ip) {
    if (!ip) return "";
    // strip IPv6 mapped IPv4 prefix if present
    if (ip.startsWith("::ffff:")) return ip.substring(7);
    // strip IPv6 zone id if present
    const percent = ip.indexOf("%");
    if (percent !== -1) ip = ip.substring(0, percent);
    return ip;
}

function ipAllowed(ip) {
    if (!ALLOWED_IPS || ALLOWED_IPS.length === 0) return false;
    if (ALLOWED_IPS.length === 1 && ALLOWED_IPS[0] === "*") return true;
    for (const rule of ALLOWED_IPS) {
        if (rule === "*") return true;
        // exact match
        if (rule === ip) return true;
        // allow prefix match (simple subnet style), e.g. "192.168.1." allows "192.168.1.5"
        if (rule.endsWith(".") && ip.startsWith(rule)) return true;
    }
    return false;
}

// Basic auth middleware
function basicAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="Restricted"');
        return res.status(401).send('Authentication required');
    }
    const base64Credentials = auth.split(' ')[1] || '';
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [user, pass] = credentials.split(':');
    if (user === BASIC_USER && pass === BASIC_PASS) return next();
    res.set('WWW-Authenticate', 'Basic realm="Restricted"');
    return res.status(401).send('Invalid credentials');
}

// IP allowlist middleware
function ipAllowlist(req, res, next) {
    const clientIp = getClientIp(req);
    if (!ipAllowed(clientIp)) {
        console.warn(`Blocked request from IP: ${clientIp} path:${req.path}`);
        return res.status(403).send('Forbidden');
    }
    return next();
}

// Apply security middlewares to all routes
app.use((req, res, next) => {
    // log brief info
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} from ${getClientIp(req)}`);
    next();
});
app.use(ipAllowlist);
app.use(basicAuth);


async function compressToTarget(buffer, options = {}) {
    let quality = 85;
    let width;

    let output = buffer;

    while (output.length > MAX_SIZE && quality >= 40) {
        const image = sharp(buffer);
        const meta = await image.metadata();

        if (!width) {
            width = meta.width;
        }

        width = Math.round(width * 0.9); // resize bertahap (90%)

        output = await image
            .resize({ width, withoutEnlargement: true })
            .jpeg({
                quality,
                mozjpeg: true
            })
            .toBuffer();

        quality -= 10;
    }

    return output;
}


// ----- Routes -----
app.post('/watermark', upload.single('photo'), async (req, res) => {
    try {
        const datetime = new Date()
            .toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
            .replace('T', ' ');

        const watermarkSVG = `
            <svg width="900" height="220">
            <style>
                .wm {
                fill: white;
                fill-opacity: 0.55;
                font-size: 28px;
                font-family: Arial, Helvetica, sans-serif;
                }
            </style>

            <rect x="0" y="0" width="100%" height="100%"
                    fill="black" fill-opacity="0.25"/>

            <text x="98%" y="40" text-anchor="end" class="wm">ABC Apps</text>
            <text x="98%" y="80" text-anchor="end" class="wm">
                Jl Dipait Unus No 23, Tangerang, Banten 10254
            </text>
            <text x="98%" y="120" text-anchor="end" class="wm">
                ${req.body.lat}, ${req.body.lng}
            </text>
            <text x="98%" y="160" text-anchor="end" class="wm">
                ${datetime}
            </text>
            </svg>
        `;

        const imageBuffer = await sharp(req.file.buffer)
            .rotate()
            .composite([
                { input: Buffer.from(watermarkSVG), gravity: 'southeast' }
            ])
            .jpeg({ quality: 85 })
            .toBuffer();

        res.set({
            'Content-Type': 'image/jpeg',
            'Content-Disposition': 'inline; filename="watermarked.jpg"',
            'Cache-Control': 'no-store'
        });

        res.send(imageBuffer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Watermark failed' });
    }
});

// health
app.get("/health", (req, res) => res.json({ ok: true, port: PORT }));

app.listen(PORT, () => console.log(`HTML → PDF API running on port ${PORT}`));
