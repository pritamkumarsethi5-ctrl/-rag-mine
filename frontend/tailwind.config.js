/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a1017",
        panel: "#111a24",
        panel2: "#16212d",
        line: "#223142",
        ink: "#e6edf3",
        mute: "#8a9bad",
        accent: "#22d3ee",
        teal: "#2dd4bf",
        ok: "#34d399",
        warn: "#fbbf24",
        crit: "#f87171",
        unk: "#94a3b8",
      },
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans Devanagari"', '"Noto Sans Oriya"', '"Nirmala UI"', "system-ui", "sans-serif"],
        mono: ['ui-monospace', '"JetBrains Mono"', "Consolas", "monospace"],
      },
      keyframes: { pulseRing: { "0%,100%": { opacity: ".9" }, "50%": { opacity: ".35" } } },
      animation: { pulseRing: "pulseRing 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
};
