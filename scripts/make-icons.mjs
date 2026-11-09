// Generates PWA / notification icons (run: node scripts/make-icons.mjs)
import sharp from "sharp";

const ACCENT = "#2b54c9";
const glyph = (size, color) =>
  `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${size}" fill="${color}">B</text>`;
const app = (s, radius = 0.22) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
    <rect width="${s}" height="${s}" rx="${s * radius}" fill="${ACCENT}"/>${glyph(s * 0.58, "#ffffff")}
  </svg>`;
const badge = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${glyph(s * 0.8, "#ffffff")}</svg>`;

const out = [
  ["public/icons/icon-192.png", app(192)],
  ["public/icons/icon-512.png", app(512)],
  ["public/icons/maskable-512.png", app(512, 0)],
  ["public/icons/badge-96.png", badge(96)],
  ["src/app/icon.png", app(64)],
  ["src/app/apple-icon.png", app(180, 0)],
];
for (const [file, svg] of out) await sharp(Buffer.from(svg)).png().toFile(file);
console.log("icons written");
