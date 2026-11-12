import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#F6F5F0",
        surface: "#FFFFFF",
        stone: "#EFECE4",
        border: "#DCD7CA",
        ink: "#1E2430",
        muted: "#4A5262",
        subtle: "#7A8291",
        terracotta: {
          DEFAULT: "#C85A32",
          dark: "#A84622",
        },
        olive: {
          DEFAULT: "#5F6F3A",
          dark: "#4A572C",
        },
        ochre: {
          DEFAULT: "#D99B38",
          dark: "#8C5E14",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
