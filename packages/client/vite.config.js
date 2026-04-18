"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vite_1 = require("vite");
const plugin_react_1 = __importDefault(require("@vitejs/plugin-react"));
const vite_2 = __importDefault(require("@tailwindcss/vite"));
exports.default = (0, vite_1.defineConfig)({
    plugins: [(0, plugin_react_1.default)(), (0, vite_2.default)()],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3001',
            '/ws': {
                target: 'ws://localhost:3001',
                ws: true,
            },
        },
    },
});
//# sourceMappingURL=vite.config.js.map