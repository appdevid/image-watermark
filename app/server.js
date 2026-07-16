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

console.log(`BASIC_USER ${BASIC_USER}`);
console.log(`BASIC_PASS ${BASIC_PASS}`);

// ----- Helpers -----
function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        const first = xff.split(",")[0].trim();
        return normalizeIp(first);
    }
    const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
    return normalizeIp(remote);
}

function normalizeIp(ip) {
    if (!ip) return "";
    if (ip.startsWith("::ffff:")) return ip.substring(7);
    const percent = ip.indexOf("%");
    if (percent !== -1) ip = ip.substring(0, percent);
    return ip;
}

function ipAllowed(ip) {
    if (!ALLOWED_IPS || ALLOWED_IPS.length === 0) return false;
    if (ALLOWED_IPS.length === 1 && ALLOWED_IPS[0] === "*") return true;
    for (const rule of ALLOWED_IPS) {
        if (rule === "*") return true;
        if (rule === ip) return true;
        if (rule.endsWith(".") && ip.startsWith(rule)) return true;
    }
    return false;
}

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

function ipAllowlist(req, res, next) {
    const clientIp = getClientIp(req);
    if (!ipAllowed(clientIp)) {
        console.warn(`Blocked request from IP: ${clientIp} path:${req.path}`);
        return res.status(403).send('Forbidden');
    }
    return next();
}

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} from ${getClientIp(req)}`);
    next();
});
app.use(ipAllowlist);
app.use(basicAuth);


async function compressToTarget(buffer, options = {}) {
    let quality = 85;
    let width;

    let output = buffer;

    while (output.length > options.maxSizeByte && quality >= 20) {
        const image = sharp(buffer);
        const meta = await image.metadata();

        if (!width) {
            width = meta.width;
        }

        width = Math.round(width * 0.9);

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
            weekday: 'long',
            timeZone: 'Asia/Jakarta'
        });

        const imageMeta = await sharp(req.file.buffer).metadata();

        // ✅ Deteksi orientasi & aspect ratio
        const isLandscape = imageMeta.width >= imageMeta.height;
        const aspectRatio = imageMeta.width / imageMeta.height;

        // ✅ Scale berdasarkan width
        const scale = Math.min(imageMeta.width / 1080, 1.5);

        const timeSize = Math.max(Math.round(96 * scale), 12);
        const dateSize = Math.max(Math.round(36 * scale), 10);
        const metaSize = Math.max(Math.round(26 * scale), 8);

        const addressLines = wrapText(req.body.address, 70);

        // ✅ Semua posisi dalam koordinat SVG viewBox (0-1200 x 0-350)
        // Tidak ikut scale gambar — SVG yang handle scaling saat di-resize
        const svgXTime = 30;
        const svgYTime = 130;

        const svgXRect = 410;   // ← geser kanan, setelah "13:50" selesai
        const svgYRect = 25;
        const svgRectWidth = 8;
        const svgRectHeight = 115;

        const svgXDate = 435;   // ← rect + gap
        const svgYDate1 = 75;
        const svgYDate2 = 130;

        const svgXMeta = 30;
        const svgYMeta = 190;
        const svgLineHeight = 36;

        // font size dalam SVG viewBox coords (fixed, tidak ikut scale gambar)
        const svgTimeSize = 110;
        const svgDateSize = 46;
        const svgMetaSize = 32;

        const watermarkSVG = `
            <svg width="100%" height="350"
                viewBox="0 0 1200 350"
                preserveAspectRatio="none"
                xmlns="http://www.w3.org/2000/svg">

            <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#000" stop-opacity="0.15"/>
                <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
            </linearGradient>
            </defs>

            <style>
            .time { fill:white; font-size:${svgTimeSize}px; font-weight:700; font-family:Arial,Helvetica,sans-serif; }
            .date { fill:white; font-size:${svgDateSize}px; font-weight:500; font-family:Arial,Helvetica,sans-serif; }
            .meta { fill:white; font-size:${svgMetaSize}px; opacity:.85; font-family:Arial,Helvetica,sans-serif; }
            </style>

            <rect width="1200" height="350" fill="url(#bg)"/>

            <text x="${svgXTime}" y="${svgYTime}" class="time">${time}</text>

            <rect x="${svgXRect}" y="${svgYRect}" width="${svgRectWidth}" height="${svgRectHeight}" fill="#FFC107"/>

            <text x="${svgXDate}" y="${svgYDate1}" class="date">${date}</text>
            <text x="${svgXDate}" y="${svgYDate2}" class="date">${day}</text>

            <text x="${svgXMeta}" y="${svgYMeta}" class="meta">
            ${addressLines.map((l, i) =>
            `<tspan x="${svgXMeta}" dy="${i === 0 ? 0 : svgLineHeight}">${l}</tspan>`
        ).join('')}
            </text>

            <text x="${svgXMeta}" y="${svgYMeta + addressLines.length * svgLineHeight + 10}" class="meta">
            ${req.body.lat || ''}, ${req.body.lng || ''}
            </text>

            <text x="${svgXMeta}" y="${svgYMeta + addressLines.length * svgLineHeight + 50}" class="meta">
            ${req.body.apps || ''}
            </text>

            </svg>`;

        const gravity = req.body.gravity || 'southwest';

        // ✅ wmHeight adaptif berdasarkan orientasi
        const wmWidth = Math.min(Math.round(imageMeta.width * 0.95), imageMeta.width);

        let wmHeightRatio;
        if (isLandscape) {
            wmHeightRatio = Math.max(0.15, 0.28 / aspectRatio);
        } else {
            wmHeightRatio = 0.28;
        }

        const wmHeight = Math.min(Math.round(imageMeta.width * wmHeightRatio), imageMeta.height);

        const watermarkBuffer = await sharp(Buffer.from(watermarkSVG))
            .resize({
                width: wmWidth,
                height: wmHeight,
                fit: 'inside',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toBuffer();

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

        const maxSizeByte = (req.body.max_size || 500) * 1024;

        const finalImage = watermarked.length > maxSizeByte
            ? await compressToTarget(watermarked, { maxSizeByte })
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