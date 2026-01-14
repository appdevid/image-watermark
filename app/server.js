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

    while (output.length > options.maxSizeKb && quality >= 40) {
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

function wrapText(text, maxChars = 50) {
    const words = text.split(' ');
    const lines = [];
    let line = '';

    for (const word of words) {
        if ((line + word).length > maxChars) {
            lines.push(line.trim());
            line = word + ' ';
        } else {
            line += word + ' ';
        }
    }
    lines.push(line.trim());
    return lines;
}



// ----- Routes -----
app.post('/watermark', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'photo is required' });
        }

        const dateObj = new Date();

        const time = dateObj.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        });

        const date = dateObj.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'Asia/Jakarta'
        });

        const day = dateObj.toLocaleDateString('id-ID', {
            weekday: 'short',
            timeZone: 'Asia/Jakarta'
        });

        const imageMeta = await sharp(req.file.buffer).metadata();

        // 🔒 SCALABLE FONT SIZE (PROPORSIONAL)
        // const scale = Math.min(imageMeta.width / 1920, imageMeta.height / 1080, 1); // scale relatif
        const scale = Math.min(imageMeta.width / 1920, imageMeta.height / 1080, 1) * 2; // naikkan 20%

        const timeSize = Math.max(Math.round(96 * scale), 12);
        const dateSize = Math.max(Math.round(36 * scale), 10);
        const metaSize = Math.max(Math.round(26 * scale), 8);

        // 🔒 FIX FONT SIZE (NO SCALE)
        // const timeSize = 96;
        // const dateSize = 36;
        // const metaSize = 26;

        const addressLines = wrapText(req.body.address, 60);

        const baseXTime = 40;   // nilai default
        const baseXRect = 360;
        const baseXDate = 386;

        const xTime = Math.round(baseXTime * scale);
        const xRect = Math.round(baseXRect * scale);
        const xDate = Math.round(baseXDate * scale);

        const yTime = Math.round(110 * scale);
        const yDate1 = Math.round(70 * scale);
        const yDate2 = Math.round(120 * scale);

        const rectWidth = Math.round(6 * scale);
        const rectHeight = Math.round(120 * scale);

        const watermarkSVG = `
            <svg width="100%" height="35%"
                viewBox="0 0 1200 400"
                preserveAspectRatio="none"
                xmlns="http://www.w3.org/2000/svg">

            <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#000" stop-opacity="0.15"/>
                <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
            </linearGradient>
            </defs>

            <style>
            .time { fill:white; font-size:${timeSize}px; font-weight:700; font-family:Arial,Helvetica,sans-serif; }
            .date { fill:white; font-size:${dateSize}px; font-weight:500; font-family:Arial,Helvetica,sans-serif; }
            .meta { fill:white; font-size:${metaSize}px; opacity:.85; font-family:Arial,Helvetica,sans-serif; }
            </style>

            <rect width="1200" height="320" fill="url(#bg)"/>

            <text x="${xTime}" y="${yTime}" class="time">${time}</text>
            <rect x="${xRect}" y="30" width="${rectWidth}" height="${rectHeight}" fill="#FFC107"/>

            <text x="${xDate}" y="${yDate1}" class="date">${date}</text>
            <text x="${xDate}" y="${yDate2}" class="date">${day}</text>

            <text x="40" y="190" class="meta">
            ${addressLines.map((l, i) =>
            `<tspan x="40" dy="${i === 0 ? 0 : metaSize + 6}">${l}</tspan>`
        ).join('')}
            </text>

            <text x="40" y="${200 + addressLines.length * (metaSize + 6)}" class="meta">
            ${req.body.lat || ''}, ${req.body.lng || ''}
            </text>

            <text x="40" y="${240 + addressLines.length * (metaSize + 6)}" class="meta">
            ${req.body.apps || ''}
            </text>

            </svg>`;

        const gravity = req.body.gravity || 'southwest';

        // ✅ WATERMARK SIZE AMAN
        // const wmHeight = Math.min(320, Math.round(imageMeta.height * 0.35));
        // const wmWidth = Math.round(imageMeta.width * 0.9);

        // ✅ WATERMARK SIZE +20%
        const wmHeight = Math.min(Math.round(imageMeta.height * 0.4 * 1.2), imageMeta.height); // 35% x1.2 = 42% tinggi foto
        const wmWidth = Math.min(Math.round(imageMeta.width * 0.9 * 1.2), imageMeta.width); // 90% x1.2 = 108% → dibatasi max width foto

        const watermarkBuffer = await sharp(Buffer.from(watermarkSVG))
            .resize({
                width: wmWidth,
                height: wmHeight,
                fit: 'inside',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toBuffer();

        // const watermarkBuffer = Buffer.from(watermarkSVG);


        const watermarked = await sharp(req.file.buffer)
            .rotate()
            .composite([
                {
                    input: watermarkBuffer,
                    gravity
                }
            ])
            .jpeg({ quality: 90 })
            .toBuffer();

        const maxSizeKb = (req.body.max_size || 500) * 1024;

        const finalImage = watermarked.length > maxSizeKb
            ? await compressToTarget(watermarked, maxSizeKb)
            : watermarked;

        res.set({
            'Content-Type': 'image/jpeg',
            'Content-Disposition': 'inline; filename="watermarked.jpg"',
            'Cache-Control': 'no-store'
        });

        res.send(finalImage);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Watermark failed' });
    }
});


// health
app.get("/health", (req, res) => res.json({ ok: true, port: PORT }));

app.listen(PORT, () => console.log(`HTML → PDF API running on port ${PORT}`));
